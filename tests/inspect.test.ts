import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { exportBundle } from '../src/bundle/exporter.js';
import { extractBundle } from '../src/bundle/importer.js';
import { generateManifest } from '../src/integrity/manifest.js';
import { generateVerificationReport } from '../src/integrity/report.js';
import { verifySession } from '../src/integrity/verifier.js';
import type { Session, EnvironmentFingerprint } from '../src/types.js';

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
    id: 'inspect-test-123',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z',
    status: 'completed',
    command: 'echo test',
    profile: 'default',
    projectPath: '/tmp/project',
    exitCode: 0,
    events: [
      { type: 'command_start', timestamp: '2026-01-01T00:00:00.000Z', command: 'echo test' },
      { type: 'file_created', timestamp: '2026-01-01T00:01:00.000Z', path: 'new.ts', size: 100, diff: '+export function x() {}' },
      { type: 'command_end', timestamp: '2026-01-01T00:05:00.000Z', exitCode: 0 },
    ],
  };
  session.manifest = generateManifest(session, fingerprint);
  return session;
}

function makeSessionWithPolicyDecisions(): Session {
  const session: Session = {
    id: 'inspect-policy-test',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z',
    status: 'completed',
    command: 'npm install express',
    profile: 'default',
    projectPath: '/tmp/project',
    exitCode: 0,
    events: [
      { type: 'policy_decision', timestamp: '2026-01-01T00:00:00.000Z', command: 'npm install express', action: 'allow', risk: 'low', category: 'package', rule: 'npm-install', source: 'default-policy', reason: 'npm package installation' },
      { type: 'command_start', timestamp: '2026-01-01T00:00:01.000Z', command: 'npm install express' },
      { type: 'command_end', timestamp: '2026-01-01T00:05:00.000Z', exitCode: 0 },
    ],
  };
  session.manifest = generateManifest(session, fingerprint);
  return session;
}

describe('inspect (extractBundle + report)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ithilien-inspect-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('extracts session metadata from a valid bundle', async () => {
    const session = makeSession();
    const bundlePath = await exportBundle(session, tempDir);

    const { session: extracted, metadata } = extractBundle(bundlePath);

    expect(extracted.id).toBe('inspect-test-123');
    expect(extracted.status).toBe('completed');
    expect(extracted.command).toBe('echo test');
    expect(metadata.formatVersion).toBe(1);
  });

  it('reports valid integrity for a valid bundle', async () => {
    const session = makeSession();
    const bundlePath = await exportBundle(session, tempDir);

    const { result } = extractBundle(bundlePath);

    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(3);
  });

  it('reports invalid integrity for a tampered bundle', async () => {
    const session = makeSession();
    const bundlePath = await exportBundle(session, tempDir);

    // Create a tampered bundle by building a new ZIP with modified session data
    const originalZip = new AdmZip(bundlePath);
    const sessionData: Session = JSON.parse(
      originalZip.getEntry('session.json')!.getData().toString('utf-8'),
    );
    (sessionData.events[1] as { path: string }).path = 'HACKED.ts';

    const tamperedZip = new AdmZip();
    tamperedZip.addFile('metadata.json', originalZip.getEntry('metadata.json')!.getData());
    tamperedZip.addFile('session.json', Buffer.from(JSON.stringify(sessionData)));
    tamperedZip.addFile('manifest.json', originalZip.getEntry('manifest.json')!.getData());
    const tamperedPath = join(tempDir, 'tampered.ithilien-bundle');
    tamperedZip.writeZip(tamperedPath);

    const { result } = extractBundle(tamperedPath);

    expect(result.valid).toBe(false);
    expect(result.brokenChainAt).toBe(1);
  });

  it('preserves policy decisions in extraction', async () => {
    const session = makeSessionWithPolicyDecisions();
    const bundlePath = await exportBundle(session, tempDir);

    const { session: extracted, result } = extractBundle(bundlePath);

    expect(result.valid).toBe(true);
    const policyEvents = extracted.events.filter((e) => e.type === 'policy_decision');
    expect(policyEvents).toHaveLength(1);
    expect(policyEvents[0]).toMatchObject({
      action: 'allow',
      risk: 'low',
      category: 'package',
    });
  });

  it('generates a report with schemaVersion and bundle info', async () => {
    const session = makeSession();
    const bundlePath = await exportBundle(session, tempDir);

    const { session: extracted, metadata, result } = extractBundle(bundlePath);
    const report = generateVerificationReport(extracted, result);

    expect(report.schemaVersion).toBe(1);
    expect(report.valid).toBe(true);
    expect(report.sessionId).toBe('inspect-test-123');

    // Bundle section would be added by the inspect command, but the report itself is valid
    expect(report.events.total).toBe(3);
    expect(report.events.byCategory).toHaveProperty('lifecycle');
    expect(report.events.byCategory).toHaveProperty('filesystem');
  });

  it('extracts bundles regardless of file extension', async () => {
    const session = makeSession();
    const bundlePath = await exportBundle(session, tempDir);

    // Rename to a non-standard extension
    const renamedPath = join(tempDir, 'test-bundle.zip');
    const { rename } = await import('node:fs/promises');
    await rename(bundlePath, renamedPath);

    // Should still extract successfully
    const { session: extracted, result } = extractBundle(renamedPath);
    expect(extracted.id).toBe('inspect-test-123');
    expect(result.valid).toBe(true);
  });
});
