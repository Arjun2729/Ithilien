import { describe, it, expect } from 'vitest';
import { verifySession } from '../src/integrity/verifier.js';
import { generateManifest } from '../src/integrity/manifest.js';
import { generateSigningKey, signRootHash, hasSigningKey } from '../src/integrity/signer.js';
import type { Session, EnvironmentFingerprint } from '../src/types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fingerprint: EnvironmentFingerprint = {
  dockerImageId: 'sha256:abc123',
  dockerImageTag: 'ithilien/sandbox:latest',
  agentCommand: 'echo test',
  hostOS: 'darwin-arm64',
  nodeVersion: 'v20.0.0',
  ithilienVersion: '0.1.0',
  guardrailProfile: 'default',
  profileHash: 'deadbeef'.repeat(8),
  networkMode: 'allowlist',
  networkAllowlist: ['github.com'],
  capturedAt: '2026-01-01T00:00:00.000Z',
};

function makeSession(): Session {
  return {
    id: 'verify-test',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z',
    status: 'completed',
    command: 'echo test',
    profile: 'default',
    projectPath: '/tmp/project',
    exitCode: 0,
    events: [
      { type: 'command_start', timestamp: '2026-01-01T00:00:00.000Z', command: 'echo test' },
      { type: 'file_created', timestamp: '2026-01-01T00:01:00.000Z', path: 'new.ts', size: 100 },
      { type: 'file_modified', timestamp: '2026-01-01T00:02:00.000Z', path: 'old.ts', diff: '+line\n-removed' },
      { type: 'command_end', timestamp: '2026-01-01T00:05:00.000Z', exitCode: 0 },
    ],
  };
}

describe('verifier', () => {
  it('passes for a valid session with intact hash chain', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);

    const result = verifySession(session);
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(4);
    expect(result.details).toContain('Integrity verified');
  });

  it('fails for a session with no manifest', () => {
    const session = makeSession();
    const result = verifySession(session);
    expect(result.valid).toBe(false);
    expect(result.details).toContain('no manifest');
  });

  it('detects event count mismatch', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    // Add an extra event after manifest was generated
    session.events.push({
      type: 'stdout',
      timestamp: '2026-01-01T00:06:00.000Z',
      data: 'extra',
    });

    const result = verifySession(session);
    expect(result.valid).toBe(false);
    expect(result.details).toContain('Event count mismatch');
  });

  it('detects tampered event content', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    // Tamper with an event
    (session.events[1] as { path: string }).path = 'HACKED.ts';

    const result = verifySession(session);
    expect(result.valid).toBe(false);
    expect(result.brokenChainAt).toBe(1);
    expect(result.details).toContain('Hash chain broken at event 1');
  });

  it('detects tampered root hash', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    // Tamper with the root hash
    session.manifest.rootHash = 'f'.repeat(64);

    const result = verifySession(session);
    expect(result.valid).toBe(false);
    expect(result.details).toContain('Root hash mismatch');
  });
});
