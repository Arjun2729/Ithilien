import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import os from 'node:os';
import type { EnvironmentFingerprint, GuardrailProfile } from '../types.js';

function getPackageVersion(): string {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  // Works from both src/integrity/ (dev/test) and dist/ (bundled)
  for (const rel of ['../../package.json', '../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, rel), 'utf-8'));
      if (pkg.name === 'ithilien') return pkg.version;
    } catch { /* try next */ }
  }
  return 'unknown';
}

/**
 * Capture an environment fingerprint at the start of a session.
 * Records the Docker image, agent command, host info, and guardrail profile.
 */
export function captureFingerprint(
  dockerImageId: string,
  dockerImageTag: string,
  agentCommand: string,
  profile: GuardrailProfile,
): EnvironmentFingerprint {
  const profileHash = createHash('sha256')
    .update(JSON.stringify(profile))
    .digest('hex');

  return {
    dockerImageId,
    dockerImageTag,
    agentCommand,
    hostOS: `${os.platform()}-${os.arch()}`,
    nodeVersion: process.version,
    ithilienVersion: getPackageVersion(),
    guardrailProfile: profile.name,
    profileHash,
    networkMode: profile.network.mode,
    networkAllowlist: profile.network.allowlist || [],
    capturedAt: new Date().toISOString(),
  };
}
