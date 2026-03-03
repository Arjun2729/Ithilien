import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'node:path';
import { mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig, resolveProfile } from '../config/loader.js';
import Docker from 'dockerode';
import { checkDocker, ensureSandboxImage, runInContainer, extractVolumeContents, removeVolume } from '../sandbox/container.js';
import { AuditLogger } from '../audit/logger.js';
import { takeSnapshot, diffSnapshots, generateDiffs, type FileChange } from '../audit/fs-watcher.js';
import { createSession, saveSession, computeSummary, setSessionsDir } from '../audit/session.js';
import { renderTerminalSummary } from '../audit/report.js';
import { captureFingerprint } from '../integrity/fingerprint.js';
import { generateManifest } from '../integrity/manifest.js';
import { hasSigningKey, signRootHash } from '../integrity/signer.js';

export interface RunOptions {
  profile: string;
  timeout?: string;
  sandbox: boolean;
  verbose: boolean;
  env: string[];
}

export async function runCommand(command: string, opts: RunOptions): Promise<void> {
  const projectPath = resolve(process.cwd());
  const config = await loadConfig(projectPath);
  setSessionsDir(config.sessionsDir);
  const profile = await resolveProfile(opts.profile, projectPath);

  // Override timeout if specified
  if (opts.timeout) {
    const parsed = parseInt(opts.timeout, 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error(chalk.red(`  Invalid --timeout value: "${opts.timeout}". Must be a positive integer (seconds).`));
      process.exit(1);
    }
    profile.resources.maxDuration = parsed;
  }

  // --- No-sandbox mode ---
  if (!opts.sandbox) {
    console.log('');
    console.log(chalk.yellow('  \u26A0  Running without sandbox (--no-sandbox)'));
    console.log(chalk.yellow('  \u26A0  The agent has full access to your system.'));
    console.log(chalk.yellow('  \u26A0  Guardrails are NOT enforced.'));
    console.log('');

    const session = createSession(command, profile.name, projectPath);
    const logger = new AuditLogger();
    logger.commandStart(command);

    try {
      execSync(command, {
        cwd: projectPath,
        stdio: 'inherit',
        timeout: profile.resources.maxDuration * 1000,
        env: { ...process.env, ...parseEnvVars(opts.env) },
      });
      logger.commandEnd(0);
      session.exitCode = 0;
      session.status = 'completed';
    } catch (err: unknown) {
      const exitCode = (err as { status?: number }).status ?? 1;
      logger.commandEnd(exitCode);
      session.exitCode = exitCode;
      session.status = 'failed';
    }

    session.completedAt = new Date().toISOString();
    session.events = logger.getEvents();
    session.summary = computeSummary(session);

    // Integrity: fingerprint + manifest + optional signing (no-sandbox mode)
    const fingerprint = captureFingerprint('none', 'none', command, profile);
    const manifest = generateManifest(session, fingerprint);
    if (hasSigningKey()) {
      const { signature, publicKey } = signRootHash(manifest.rootHash);
      manifest.signature = signature;
      manifest.publicKey = publicKey;
    }
    session.manifest = manifest;

    await saveSession(session);
    console.log(renderTerminalSummary(session, session.summary));
    return;
  }

  // --- Sandboxed mode ---
  console.log('');
  console.log(chalk.bold.white('  Ithilien'));
  console.log(chalk.dim('  ' + '\u2500'.repeat(40)));
  console.log('');

  // Check Docker
  const spinner = ora({ text: 'Checking Docker...', indent: 2 }).start();
  const dockerCheck = await checkDocker();
  if (!dockerCheck.available) {
    spinner.fail('Docker not available');
    console.log('');
    console.log(chalk.red('  ' + dockerCheck.error));
    console.log('');
    console.log(chalk.dim('  Tip: use --no-sandbox to run without Docker (not recommended)'));
    console.log('');
    process.exit(1);
  }
  spinner.succeed('Docker available');

  // Ensure sandbox image
  const imgSpinner = ora({ text: 'Preparing sandbox image...', indent: 2 }).start();
  let dockerImageId = 'unknown';
  const dockerImageTag = 'ithilien/sandbox:latest';
  try {
    await ensureSandboxImage(opts.verbose);
    // Capture image ID for fingerprint
    try {
      const docker = new Docker();
      const imgInfo = await docker.getImage(dockerImageTag).inspect();
      dockerImageId = imgInfo.Id || 'unknown';
    } catch { /* non-critical */ }
    imgSpinner.succeed('Sandbox image ready');
  } catch (err) {
    imgSpinner.fail('Failed to prepare sandbox image');
    console.error(chalk.red('  ' + (err as Error).message));
    process.exit(1);
  }

  // Take pre-execution snapshot
  const snapSpinner = ora({ text: 'Snapshotting project...', indent: 2 }).start();
  const beforeSnapshot = await takeSnapshot(projectPath);
  snapSpinner.succeed(`Snapshot: ${beforeSnapshot.size} files`);

  // Create session
  const session = createSession(command, profile.name, projectPath);
  const logger = new AuditLogger();
  logger.commandStart(command);

  console.log('');
  console.log(`  ${chalk.dim('Profile:')}  ${chalk.white(profile.name)} ${chalk.dim('(' + profile.description + ')')}`);
  console.log(`  ${chalk.dim('Timeout:')}  ${chalk.white(formatDuration(profile.resources.maxDuration))}`);
  console.log(`  ${chalk.dim('Network:')}  ${chalk.white(profile.network.mode)}`);
  console.log(`  ${chalk.dim('Command:')}  ${chalk.cyan(command)}`);
  console.log('');
  console.log(chalk.dim('  ' + '\u2500'.repeat(40)));
  console.log('');

  // Run in container
  let timedOut = false;
  let workspaceVolume: string | null = null;
  try {
    const result = await runInContainer({
      command,
      projectPath,
      profile,
      envVars: opts.env,
      verbose: opts.verbose,
      onStdout: (data) => {
        process.stdout.write(data);
        logger.stdout(data);
      },
      onStderr: (data) => {
        process.stderr.write(data);
        logger.stderr(data);
      },
    });

    workspaceVolume = result.workspacePath;

    if (result.exitCode === -1) {
      timedOut = true;
      session.status = 'timeout';
      session.exitCode = -1;
      logger.guardrailTriggered('timeout', 'kill', `Session exceeded ${profile.resources.maxDuration}s limit`);
    } else {
      session.exitCode = result.exitCode;
      session.status = result.exitCode === 0 ? 'completed' : 'failed';
    }
    logger.commandEnd(result.exitCode);

    // Extract workspace and diff
    console.log('');
    const diffSpinner = ora({ text: 'Analyzing changes...', indent: 2 }).start();

    const tempDir = await mkdtemp(join(tmpdir(), 'ithilien-'));
    try {
      await extractVolumeContents(result.workspacePath, tempDir);

      const changes = await diffSnapshots(beforeSnapshot, tempDir);
      const enriched = await generateDiffs(projectPath, tempDir, changes);

      // Store changes as events (with diffs for all types)
      for (const change of enriched) {
        if (change.type === 'created') {
          logger.fileCreated(change.path, change.size, change.diff);
        } else if (change.type === 'modified') {
          logger.fileModified(change.path, change.diff);
        } else if (change.type === 'deleted') {
          logger.fileDeleted(change.path, change.diff);
        }
      }

      diffSpinner.succeed(`${changes.length} file(s) changed`);

      // Store the changed files in ~/.ithilien/sessions/<id>/files for `apply`
      const { ensureSessionsDir } = await import('../audit/session.js');
      const sessionsBaseDir = await ensureSessionsDir();
      const sessionFilesDir = join(sessionsBaseDir, session.id, 'files');
      try {
        await mkdir(sessionFilesDir, { recursive: true });
        for (const change of changes) {
          if (change.type !== 'deleted') {
            const src = join(tempDir, change.path);
            const dest = join(sessionFilesDir, change.path);
            await mkdir(join(dest, '..'), { recursive: true });
            await cp(src, dest);
          }
        }
      } catch {
        // Non-critical — diffs are still stored in the session JSON
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    // Clean up volume
    await removeVolume(result.workspacePath);
  } catch (err) {
    session.status = 'failed';
    session.exitCode = 1;
    logger.commandEnd(1);
    console.error('');
    console.error(chalk.red('  Error: ' + (err as Error).message));
    if (workspaceVolume) {
      await removeVolume(workspaceVolume);
    }
  }

  // Save session
  session.completedAt = new Date().toISOString();
  session.events = logger.getEvents();
  session.summary = computeSummary(session);

  // Integrity: fingerprint + manifest + optional signing
  const fingerprint = captureFingerprint(dockerImageId, dockerImageTag, command, profile);
  const manifest = generateManifest(session, fingerprint);
  if (hasSigningKey()) {
    const { signature, publicKey } = signRootHash(manifest.rootHash);
    manifest.signature = signature;
    manifest.publicKey = publicKey;
  }
  session.manifest = manifest;

  const sessionPath = await saveSession(session);

  // Print summary
  console.log(renderTerminalSummary(session, session.summary));

  if (timedOut) {
    console.log(chalk.yellow('  Session timed out. Partial changes may have been captured.'));
    console.log('');
  }
}

function parseEnvVars(envVars: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const v of envVars) {
    const eq = v.indexOf('=');
    if (eq > 0) {
      result[v.slice(0, eq)] = v.slice(eq + 1);
    }
  }
  return result;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
