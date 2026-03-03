import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { exportBundle } from '../src/bundle/exporter.js';
import { generateManifest } from '../src/integrity/manifest.js';
import { verifySession } from '../src/integrity/verifier.js';
import type { Session, EnvironmentFingerprint, BundleMetadata } from '../src/types.js';

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
  const session: Session = {
    id: 'bundle-test-123',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z',
    status: 'completed',
    command: 'echo test',
    profile: 'default',
    projectPath: '/tmp/project',
    exitCode: 0,
    events: [
      { type: 'command_start', timestamp: '2026-01-01T00:00:00.000Z', command: 'echo test' },
      { type: 'file_created', timestamp: '2026-01-01T00:01:00.000Z', path: 'src/auth.ts', size: 200, diff: '+export function login() {}' },
      { type: 'file_modified', timestamp: '2026-01-01T00:02:00.000Z', path: 'package.json', diff: '-"version": "1.0"\n+"version": "1.1"' },
      { type: 'command_end', timestamp: '2026-01-01T00:05:00.000Z', exitCode: 0 },
    ],
  };
  session.manifest = generateManifest(session, fingerprint);
  return session;
}

describe('bundle', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ithilien-bundle-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('exporter', () => {
    it('creates a valid ZIP file with expected entries', async () => {
      const session = makeSession();
      const bundlePath = await exportBundle(session, tempDir);

      expect(bundlePath).toContain('.ithilien-bundle');

      const zip = new AdmZip(bundlePath);
      const entries = zip.getEntries().map((e) => e.entryName);

      expect(entries).toContain('metadata.json');
      expect(entries).toContain('session.json');
      expect(entries).toContain('manifest.json');
    });

    it('includes metadata with correct format version', async () => {
      const session = makeSession();
      const bundlePath = await exportBundle(session, tempDir);

      const zip = new AdmZip(bundlePath);
      const metadata: BundleMetadata = JSON.parse(
        zip.getEntry('metadata.json')!.getData().toString('utf-8'),
      );

      expect(metadata.formatVersion).toBe(1);
      expect(metadata.sessionId).toBe('bundle-test-123');
      expect(metadata.manifest.rootHash).toBe(session.manifest!.rootHash);
    });

    it('includes individual diff patches', async () => {
      const session = makeSession();
      const bundlePath = await exportBundle(session, tempDir);

      const zip = new AdmZip(bundlePath);
      const diffEntries = zip
        .getEntries()
        .filter((e) => e.entryName.startsWith('diffs/'));

      expect(diffEntries).toHaveLength(2);
      expect(diffEntries[0].entryName).toMatch(/\.patch$/);
    });

    it('round-trips: exported session can be verified', async () => {
      const session = makeSession();
      const bundlePath = await exportBundle(session, tempDir);

      const zip = new AdmZip(bundlePath);
      const restored: Session = JSON.parse(
        zip.getEntry('session.json')!.getData().toString('utf-8'),
      );

      const result = verifySession(restored);
      expect(result.valid).toBe(true);
    });
  });

  it('rejects export of session without manifest', async () => {
    const session = makeSession();
    delete (session as { manifest?: unknown }).manifest;

    await expect(exportBundle(session, tempDir)).rejects.toThrow(
      'Cannot export session without a manifest',
    );
  });
});
