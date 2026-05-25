import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'node:path';
import { mkdtemp, mkdir, cp, rm, writeFile, readFile } from 'node:fs/promises';
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
import { loadPolicy } from '../policy/loader.js';
import { evaluateCommand } from '../policy/evaluator.js';
import { enforceDecision, formatDecisionMessage } from '../policy/enforcer.js';
import { buildPolicyContext } from '../policy/hash.js';
import { EXIT_INVALID_INPUT } from '../exit-codes.js';
import type { PolicyDecision } from '../policy/types.js';
import { selectRuntime, describeRuntime, DOCKER_KERNEL_WARNING } from '../sandbox/runtime.js';
import { injectSidecarSystemPrompt } from '../agents/claude.js';
import { parseSidecarContent } from '../audit/reasoning-parser.js';

export interface RunOptions {
  profile: string;
  policy?: string;
  timeout?: string;
  sandbox: boolean;
  verbose: boolean;
  env: string[];
  agent?: string;
  /** Explicit runtime override. 'auto' defers to config then auto-detection. */
  runtime?: string;
  /** Mount a sidecar file at /tmp/ithilien-reasoning.jsonl for structured reasoning. */
  reasoningSidecar: boolean;
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

  // --- Agent wrapper resolution ---
  let prompt: string | undefined;
  if (opts.agent) {
    const { getAgent, getAgentNames } = await import('../agents/registry.js');
    const wrapper = getAgent(opts.agent);
    if (!wrapper) {
      const available = getAgentNames().join(', ');
      console.error(chalk.red(`  Unknown agent: "${opts.agent}"`));
      console.error(chalk.dim(`  Available agents: ${available}`));
      process.exit(EXIT_INVALID_INPUT);
    }

    // Warn about missing env vars (advisory, not blocking)
    for (const envVar of wrapper.requiredEnvVars) {
      if (!process.env[envVar]) {
        console.error(chalk.yellow(`  \u26a0  ${wrapper.displayName} typically requires ${envVar} to be set`));
      }
    }

    prompt = command;
    command = wrapper.buildCommand(command);

    if (opts.verbose) {
      console.log(chalk.dim(`  Agent: ${wrapper.displayName}`));
      console.log(chalk.dim(`  Expanded: ${command}`));
    }
  }

  // --- Load and evaluate policy ---
  const { policy, warnings: policyWarnings } = await loadPolicy({
    projectPath,
    policyPath: opts.policy,
  });

  // Print policy warnings (unsupported rule types, etc.)
  for (const w of policyWarnings) {
    console.error(chalk.yellow(`  ⚠  ${w.message}`));
  }

  const decision = evaluateCommand(command, policy);

  // Create session and logger early so denial is recorded in the audit trail
  const session = createSession(command, profile.name, projectPath);
  if (prompt !== undefined) {
    session.prompt = prompt;
    session.agent = opts.agent;
  }
  const logger = new AuditLogger();

  // Emit policy decision event for every evaluated command
  logger.policyDecision(
    command,
    decision.action,
    decision.risk,
    decision.category,
    decision.matchedRule,
    decision.source,
    decision.reason,
  );

  // Enforce the decision
  const enforcement = await enforceDecision(decision);

  if (!enforcement.proceed) {
    // Command was denied or ask was rejected — record and exit
    logger.commandStart(command);
    logger.guardrailTriggered(
      decision.matchedRule ?? 'policy',
      'deny',
      formatDenialDetail(decision, enforcement.resolution),
    );
    logger.commandEnd(1);

    session.status = 'denied';
    session.exitCode = 1;
    session.completedAt = new Date().toISOString();
    session.events = logger.getEvents();
    session.summary = computeSummary(session);

    // Integrity: still generate manifest for denied sessions
    const fingerprint = captureFingerprint('none', 'none', command, profile);
    const policyCtx = buildPolicyContext(policy, {
      policyPath: opts.policy,
      engineVersion: fingerprint.ithilienVersion,
    });
    const manifest = generateManifest(session, fingerprint, policyCtx);
    if (hasSigningKey()) {
      const { signature, publicKey } = signRootHash(manifest.rootHash);
      manifest.signature = signature;
      manifest.publicKey = publicKey;
    }
    session.manifest = manifest;

    await saveSession(session);

    // User-facing output
    console.log('');
    if (decision.action === 'deny') {
      console.log(chalk.red('  ✗ Command blocked by policy'));
    } else if (enforcement.resolution === 'denied-non-interactive') {
      console.log(chalk.red('  ✗ Command requires approval but session is non-interactive'));
    } else {
      console.log(chalk.red('  ✗ Command not approved'));
    }
    console.log('');
    console.log(formatDecisionMessage(decision));
    console.log('');
    console.log(chalk.dim(`  Session: ${session.id} (denial recorded)`));
    console.log('');
    process.exit(1);
  }

  // For 'log' decisions, print an informational notice
  if (decision.action === 'log') {
    console.log('');
    console.log(chalk.yellow(`  ◌ Policy notice: ${decision.reason}`));
    console.log(chalk.dim(`    Risk: ${decision.risk} | Category: ${decision.category}${decision.matchedRule ? ` | Rule: ${decision.matchedRule}` : ''}`));
  }

  // --- Runtime selection ---
  // Priority: --runtime flag > config > auto-detect
  const runtimePref = (opts.runtime ?? config.runtime ?? 'auto') as 'auto' | 'gvisor-runsc' | 'docker-runc';
  const chosenRuntime = selectRuntime(runtimePref);
  const runtimeInfo = describeRuntime(chosenRuntime);

  // Warn if falling back to Docker in sandbox mode (no warning needed for --no-sandbox)
  if (opts.sandbox && chosenRuntime === 'docker-runc' && runtimePref !== 'docker-runc') {
    console.log('');
    console.log(chalk.yellow('  \u26a0  ' + DOCKER_KERNEL_WARNING));
  }

  // --- Sidecar setup ---
  let sidecarDir: string | null = null;
  let sidecarPath: string | null = null;

  if (opts.reasoningSidecar && opts.sandbox) {
    sidecarDir = await mkdtemp(join(tmpdir(), 'ithilien-sidecar-'));
    sidecarPath = join(sidecarDir, 'reasoning.jsonl');
    // Create writable empty file for the container to append to
    await writeFile(sidecarPath, '', { mode: 0o666 });

    // Claude Code: inject system prompt to write structured reasoning to the sidecar
    command = injectSidecarSystemPrompt(command);
  }

  // --- No-sandbox mode ---
  if (!opts.sandbox) {
    console.log('');
    console.log(chalk.yellow('  ⚠  Running without sandbox (--no-sandbox)'));
    console.log(chalk.yellow('  ⚠  The agent has full access to your system.'));
    console.log(chalk.yellow('  ⚠  Guardrails are NOT enforced.'));
    console.log('');

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
    const policyCtx = buildPolicyContext(policy, {
      policyPath: opts.policy,
      engineVersion: fingerprint.ithilienVersion,
    });
    const manifest = generateManifest(session, fingerprint, policyCtx);
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

  // Log command start (session was created earlier for policy tracking)
  logger.commandStart(command);

  console.log('');
  const runtimeLabel = runtimeInfo.recommended
    ? chalk.green(runtimeInfo.name)
    : chalk.yellow(runtimeInfo.name);
  console.log(`  ${chalk.dim('Profile:')}  ${chalk.white(profile.name)} ${chalk.dim('(' + profile.description + ')')}`);
  console.log(`  ${chalk.dim('Runtime:')}  ${runtimeLabel} ${chalk.dim('(' + runtimeInfo.kernel + ' kernel)')}`);
  console.log(`  ${chalk.dim('Timeout:')}  ${chalk.white(formatDuration(profile.resources.maxDuration))}`);
  console.log(`  ${chalk.dim('Network:')}  ${chalk.white(profile.network.mode)}`);
  console.log(`  ${chalk.dim('Policy:')}   ${chalk.white(decision.action)} ${chalk.dim('(' + decision.source + ')')}`);
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
      runtime: chosenRuntime,
      sidecarHostPath: sidecarPath ?? undefined,
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

      // Read and ingest sidecar reasoning events (if sidecar was mounted)
      if (sidecarPath) {
        try {
          const sidecarContent = await readFile(sidecarPath, 'utf-8');
          if (sidecarContent.trim()) {
            const sidecarEvents = parseSidecarContent(sidecarContent);
            for (const ev of sidecarEvents) {
              logger.reasoningSidecar(ev.content, ev.intent);
            }
            if (opts.verbose) {
              console.log(chalk.dim(`  Sidecar: ${sidecarEvents.length} reasoning event(s) captured`));
            }
          }
        } catch { /* non-critical — session still valid without sidecar */ }
        // Clean up sidecar temp directory
        if (sidecarDir) {
          await rm(sidecarDir, { recursive: true, force: true }).catch(() => {});
          sidecarDir = null;
        }
      }

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
    // Clean up sidecar on error too
    if (sidecarDir) {
      await rm(sidecarDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Save session
  session.completedAt = new Date().toISOString();
  session.events = logger.getEvents();
  session.summary = computeSummary(session);

  // Integrity: fingerprint + manifest + optional signing
  const fingerprint = captureFingerprint(dockerImageId, dockerImageTag, command, profile);
  const policyCtx = buildPolicyContext(policy, {
    policyPath: opts.policy,
    engineVersion: fingerprint.ithilienVersion,
  });
  const manifest = generateManifest(session, fingerprint, policyCtx);
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

function formatDenialDetail(decision: PolicyDecision, resolution?: string): string {
  const parts = [decision.reason];
  if (resolution) {
    parts.push(`Resolution: ${resolution}`);
  }
  return parts.join('. ');
}
