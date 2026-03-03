import { describe, it, expect } from 'vitest';
import { generateManifest } from '../src/integrity/manifest.js';
import { buildHashChain, computeRootHash } from '../src/integrity/hasher.js';
import type { Session, EnvironmentFingerprint } from '../src/types.js';

describe('manifest', () => {
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

  const session: Session = {
    id: 'test-session',
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
      { type: 'command_end', timestamp: '2026-01-01T00:05:00.000Z', exitCode: 0 },
    ],
  };

  it('generates a manifest with correct metadata', () => {
    const manifest = generateManifest(session, fingerprint);
    expect(manifest.version).toBe(1);
    expect(manifest.sessionId).toBe('test-session');
    expect(manifest.eventCount).toBe(3);
    expect(manifest.firstEventAt).toBe('2026-01-01T00:00:00.000Z');
    expect(manifest.lastEventAt).toBe('2026-01-01T00:05:00.000Z');
    expect(manifest.fingerprint).toBe(fingerprint);
  });

  it('includes correct hash chain', () => {
    const manifest = generateManifest(session, fingerprint);
    expect(manifest.eventHashes).toHaveLength(3);

    const expectedChain = buildHashChain(session.events);
    expect(manifest.eventHashes).toEqual(expectedChain);
  });

  it('computes correct root hash', () => {
    const manifest = generateManifest(session, fingerprint);
    const expectedChain = buildHashChain(session.events);
    const expectedRoot = computeRootHash(expectedChain);
    expect(manifest.rootHash).toBe(expectedRoot);
  });

  it('handles empty events by using session startedAt for timestamps', () => {
    const emptySession: Session = {
      ...session,
      events: [],
    };
    const manifest = generateManifest(emptySession, fingerprint);
    expect(manifest.eventCount).toBe(0);
    expect(manifest.firstEventAt).toBe(session.startedAt);
    expect(manifest.lastEventAt).toBe(session.startedAt);
  });
});
