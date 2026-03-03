import { describe, it, expect } from 'vitest';
import { captureFingerprint } from '../src/integrity/fingerprint.js';
import { createHash } from 'node:crypto';
import os from 'node:os';
import type { GuardrailProfile } from '../src/types.js';

describe('fingerprint', () => {
  const profile: GuardrailProfile = {
    name: 'default',
    description: 'Balanced safety',
    filesystem: { readOnlyPaths: [], blockedPaths: [], protectedFilePatterns: [] },
    network: { mode: 'allowlist', allowlist: ['github.com'] },
    resources: { cpuLimit: '4.0', memoryLimit: '8g', maxDuration: 3600 },
    git: { allowCommit: true, allowPush: false, allowForce: false },
  };

  it('captures correct Docker and command info', () => {
    const fp = captureFingerprint('sha256:abc', 'ithilien/sandbox:latest', 'echo test', profile);
    expect(fp.dockerImageId).toBe('sha256:abc');
    expect(fp.dockerImageTag).toBe('ithilien/sandbox:latest');
    expect(fp.agentCommand).toBe('echo test');
  });

  it('captures host OS and node version', () => {
    const fp = captureFingerprint('sha256:abc', 'tag', 'cmd', profile);
    expect(fp.hostOS).toBe(`${os.platform()}-${os.arch()}`);
    expect(fp.nodeVersion).toBe(process.version);
  });

  it('computes profile hash correctly', () => {
    const fp = captureFingerprint('sha256:abc', 'tag', 'cmd', profile);
    const expectedHash = createHash('sha256')
      .update(JSON.stringify(profile))
      .digest('hex');
    expect(fp.profileHash).toBe(expectedHash);
  });

  it('captures network config from profile', () => {
    const fp = captureFingerprint('sha256:abc', 'tag', 'cmd', profile);
    expect(fp.networkMode).toBe('allowlist');
    expect(fp.networkAllowlist).toEqual(['github.com']);
  });

  it('captures ISO timestamp', () => {
    const fp = captureFingerprint('sha256:abc', 'tag', 'cmd', profile);
    expect(fp.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
