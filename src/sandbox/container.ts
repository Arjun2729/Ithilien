import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { GuardrailProfile } from '../types.js';
import { buildMountConfig } from './mounts.js';
import { buildNetworkConfig, createNetworkIfNeeded, removeNetworkIfNeeded } from './network.js';
import { buildResourceConfig } from './guardrails.js';
import { wrapCommand } from './enforce.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SANDBOX_IMAGE = 'ithilien/sandbox:latest';

export interface ContainerOptions {
  command: string;
  projectPath: string;
  profile: GuardrailProfile;
  envVars?: string[];
  verbose?: boolean;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface ContainerResult {
  exitCode: number;
  workspacePath: string; // path to the temp workspace copy
}

/**
 * Check if Docker is available and running.
 */
export async function checkDocker(): Promise<{ available: boolean; error?: string }> {
  try {
    const docker = new Docker();
    await docker.ping();
    return { available: true };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('ENOENT') || msg.includes('ECONNREFUSED')) {
      return {
        available: false,
        error: 'Docker is not running. Please start Docker Desktop or install Docker:\n  https://docs.docker.com/get-docker/',
      };
    }
    return { available: false, error: `Docker error: ${msg}` };
  }
}

/**
 * Ensure the sandbox image exists, build it if not.
 */
export async function ensureSandboxImage(verbose?: boolean): Promise<void> {
  const docker = new Docker();

  try {
    await docker.getImage(SANDBOX_IMAGE).inspect();
    return; // Image exists
  } catch {
    // Need to build
  }

  if (verbose) {
    console.log('  Building sandbox image...');
  }

  // Find Dockerfile - check multiple locations
  let dockerfilePath: string;
  const candidates = [
    join(__dirname, '..', '..', 'templates', 'Dockerfile.sandbox'),
    join(__dirname, '..', 'templates', 'Dockerfile.sandbox'),
    join(process.cwd(), 'templates', 'Dockerfile.sandbox'),
  ];

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'Sandbox Dockerfile not found. Run from the ithilien project directory or reinstall.'
    );
  }
  dockerfilePath = found;

  const dockerfileContent = await readFile(dockerfilePath, 'utf-8');

  const stream = await docker.buildImage(
    {
      context: resolve(dockerfilePath, '..'),
      src: ['Dockerfile.sandbox'],
    },
    { t: SANDBOX_IMAGE, dockerfile: 'Dockerfile.sandbox' }
  );

  // Wait for build to complete
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err: Error | null) => (err ? reject(err) : resolve()),
      (event: { stream?: string }) => {
        if (verbose && event.stream) {
          process.stdout.write('    ' + event.stream);
        }
      }
    );
  });
}

/**
 * Copy the project to a temp directory inside a Docker volume
 * so changes are isolated from the host.
 */
async function copyProjectToVolume(
  docker: Docker,
  projectPath: string,
  volumeName: string
): Promise<void> {
  // Run the copy as the container's main command — no exec needed
  const container = await docker.createContainer({
    Image: SANDBOX_IMAGE,
    Cmd: ['bash', '-c', 'cp -a /source/. /workspace/'],
    HostConfig: {
      Binds: [
        `${resolve(projectPath)}:/source:ro`,
        `${volumeName}:/workspace`,
      ],
    },
  });

  await container.start();
  const { StatusCode } = await container.wait();
  await container.remove();

  if (StatusCode !== 0) {
    throw new Error(`Failed to copy project to volume (exit code ${StatusCode})`);
  }
}

/**
 * Run a command inside a sandboxed Docker container.
 */
export async function runInContainer(opts: ContainerOptions): Promise<ContainerResult> {
  const docker = new Docker();
  const {
    command,
    projectPath,
    profile,
    envVars = [],
    verbose = false,
    onStdout,
    onStderr,
  } = opts;

  // Create an isolated volume for the workspace
  const volumeName = `ithilien-workspace-${Date.now()}`;
  await docker.createVolume({ Name: volumeName });

  let networkName: string | null = null;
  let container: Docker.Container | undefined;
  let succeeded = false;
  let step = 'init';

  try {
    // Copy project into the volume
    step = 'copy-project';
    if (verbose) console.log('  Copying project to sandbox...');
    await copyProjectToVolume(docker, projectPath, volumeName);

    // Build container config
    step = 'build-config';
    const mounts = buildMountConfig(profile, volumeName);
    const resources = buildResourceConfig(profile);
    const networkConfig = await buildNetworkConfig(docker, profile);
    networkName = networkConfig.networkName;

    // Create network if needed
    step = 'create-network';
    if (networkName) {
      await createNetworkIfNeeded(docker, networkName);
    }

    // Build env array
    const env = [
      'HOME=/home/sandbox',
      'TERM=xterm-256color',
      `ITHILIEN_PROFILE=${profile.name}`,
      ...envVars,
    ];

    // Auto-forward common API keys for agent CLIs (opt-in via host env).
    // This is a convenience so demos don't require repeating `--env KEY=...`.
    const autoForward = (key: string) => {
      const value = process.env[key];
      if (!value) return;
      if (envVars.some(v => v.startsWith(`${key}=`))) return;
      env.push(`${key}=${value}`);
    };

    autoForward('ANTHROPIC_API_KEY');
    autoForward('OPENAI_API_KEY');
    autoForward('GEMINI_API_KEY');
    autoForward('GOOGLE_API_KEY');

    // For allowlist mode, pass resolved IPs so iptables can enforce at IP level
    if (profile.network.mode === 'allowlist' && networkConfig.extraHosts.length > 0) {
      const allowedIps = [...new Set(
        networkConfig.extraHosts.map((h) => h.split(':')[1])
      )].join(',');
      env.push(`ITHILIEN_ALLOWED_IPS=${allowedIps}`);
    }

    // Grant CAP_NET_ADMIN for iptables enforcement in allowlist mode
    const capAdd = profile.network.mode === 'allowlist' ? ['NET_ADMIN'] : undefined;

    step = 'create-container';
    container = await docker.createContainer({
      Image: SANDBOX_IMAGE,
      Cmd: ['bash', '-c', wrapCommand(command, profile)],
      WorkingDir: '/workspace',
      Env: env,
      HostConfig: {
        Binds: mounts,
        Memory: resources.memory,
        NanoCpus: resources.nanoCpus,
        NetworkMode: networkConfig.networkMode,
        AutoRemove: false,
        Dns: networkConfig.dnsServers.length > 0 ? networkConfig.dnsServers : undefined,
        ExtraHosts: networkConfig.extraHosts.length > 0 ? networkConfig.extraHosts : undefined,
        CapAdd: capAdd,
      },
      NetworkDisabled: profile.network.mode === 'none',
      StopTimeout: 10,
    });

    // Attach to stdout/stderr
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    stdoutStream.on('data', (chunk: Buffer) => {
      const data = chunk.toString();
      if (onStdout) onStdout(data);
    });

    stderrStream.on('data', (chunk: Buffer) => {
      const data = chunk.toString();
      if (onStderr) onStderr(data);
    });

    // Start container before streaming logs. Some Docker setups return 409
    // if you attach to a container that hasn't started yet.
    step = 'start-container';
    await container.start();

    // Stream logs. If the container exits immediately, Docker can return 409.
    // In that case, continue without live logs.
    try {
      step = 'stream-logs';
      const stream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });
      container.modem.demuxStream(stream, stdoutStream, stderrStream);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const statusCode = (err as { statusCode?: number }).statusCode;
      const isNotRunning =
        msg.includes('is not running') ||
        msg.includes('container stopped') ||
        statusCode === 409;
      if (!isNotRunning) {
        throw err;
      }
    }

    // Set up timeout
    const timeoutMs = profile.resources.maxDuration * 1000;
    let timedOut = false;
    const timer = setTimeout(async () => {
      timedOut = true;
      try {
        await container!.stop({ t: 5 });
      } catch {
        await container!.kill().catch(() => {});
      }
    }, timeoutMs);

    // Wait for container to finish
    step = 'wait-container';
    let StatusCode: number;
    try {
      const waitResult = await container.wait();
      StatusCode = waitResult.StatusCode;
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const statusCode = (err as { statusCode?: number }).statusCode;
      const notRunning =
        msg.includes('is not running') ||
        msg.includes('container stopped') ||
        statusCode === 409;
      if (!notRunning) {
        throw err;
      }
      // Container exited before wait; inspect to get exit code.
      step = 'inspect-container';
      const info = await container.inspect();
      StatusCode = info.State?.ExitCode ?? 1;
    }
    clearTimeout(timer);

    // Clean up streams
    stdoutStream.end();
    stderrStream.end();

    // Remove the container (keep the volume for diffing)
    step = 'remove-container';
    await container.remove().catch(() => {});

    succeeded = true;
    return {
      exitCode: timedOut ? -1 : StatusCode,
      workspacePath: volumeName,
    };
  } catch (err) {
    const failureStep = step;
    // Clean up container on error
    if (container) {
      await container.stop().catch(() => {});
      await container.remove().catch(() => {});
    }
    // Clean up the volume on error — caller won't get a workspacePath to clean up
    if (!succeeded) {
      await docker.getVolume(volumeName).remove().catch(() => {});
    }
    const message = (err as Error).message ?? String(err);
    throw new Error(`runInContainer failed at ${failureStep}: ${message}`);
  } finally {
    // Always clean up the network
    if (networkName) {
      await removeNetworkIfNeeded(docker, networkName);
    }
  }
}

/**
 * Extract files from the workspace volume for diffing.
 * Returns the path to a temp directory with the workspace contents.
 */
export async function extractVolumeContents(
  volumeName: string,
  destPath: string
): Promise<void> {
  const docker = new Docker();

  // Run the copy as the container's main command — no exec needed
  const container = await docker.createContainer({
    Image: SANDBOX_IMAGE,
    Cmd: ['bash', '-c', 'cp -a /workspace/. /dest/'],
    HostConfig: {
      Binds: [
        `${volumeName}:/workspace:ro`,
        `${resolve(destPath)}:/dest`,
      ],
    },
  });

  await container.start();
  await container.wait();
  await container.remove();
}

/**
 * Remove a workspace volume.
 */
export async function removeVolume(volumeName: string): Promise<void> {
  const docker = new Docker();
  await docker.getVolume(volumeName).remove().catch(() => {});
}
