import { describe, it, expect } from 'vitest';
import { generateVerificationReport } from '../src/integrity/report.js';
import { generateManifest } from '../src/integrity/manifest.js';
import { verifySession } from '../src/integrity/verifier.js';
import { categorizeEvent } from '../src/types.js';
import type { Session, EnvironmentFingerprint, PolicyContext } from '../src/types.js';

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

describe('verify output', () => {
  it('report includes event breakdown by category', () => {
    const session: Session = {
      id: 'output-test',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:05:00.000Z',
      status: 'completed',
      command: 'echo test',
      profile: 'default',
      projectPath: '/tmp/project',
      exitCode: 0,
      events: [
        { type: 'command_start', timestamp: '2026-01-01T00:00:00.000Z', command: 'echo test' },
        { type: 'file_created', timestamp: '2026-01-01T00:01:00.000Z', path: 'a.ts', size: 100 },
        { type: 'file_modified', timestamp: '2026-01-01T00:02:00.000Z', path: 'b.ts' },
        { type: 'network_request', timestamp: '2026-01-01T00:03:00.000Z', destination: 'github.com', allowed: true },
        { type: 'command_end', timestamp: '2026-01-01T00:05:00.000Z', exitCode: 0 },
      ],
    };
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.events.byCategory).toEqual({
      lifecycle: 2,
      filesystem: 2,
      network: 1,
    });
  });

  it('report includes policy decision details', () => {
    const session: Session = {
      id: 'policy-output-test',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:05:00.000Z',
      status: 'completed',
      command: 'npm install express',
      profile: 'default',
      projectPath: '/tmp/project',
      exitCode: 0,
      events: [
        { type: 'policy_decision', timestamp: '2026-01-01T00:00:00.000Z', command: 'npm install express', action: 'allow', risk: 'low', category: 'package', rule: 'npm-install', source: 'default-policy', reason: 'allowed' },
        { type: 'command_start', timestamp: '2026-01-01T00:00:01.000Z', command: 'npm install express' },
        { type: 'command_end', timestamp: '2026-01-01T00:05:00.000Z', exitCode: 0 },
      ],
    };
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.events.byType.policy_decision).toBe(1);
    expect(report.events.byCategory.policy).toBe(1);
  });

  it('report captures denied session status prominently', () => {
    const session: Session = {
      id: 'denied-output-test',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      status: 'denied',
      command: 'rm -rf /',
      profile: 'default',
      projectPath: '/tmp/project',
      exitCode: 1,
      events: [
        { type: 'policy_decision', timestamp: '2026-01-01T00:00:00.000Z', command: 'rm -rf /', action: 'deny', risk: 'critical', category: 'filesystem', rule: 'rm-rf', source: 'default-policy', reason: 'blocked' },
        { type: 'command_start', timestamp: '2026-01-01T00:00:00.500Z', command: 'rm -rf /' },
        { type: 'guardrail_triggered', timestamp: '2026-01-01T00:00:00.500Z', rule: 'rm-rf', action: 'deny', detail: 'blocked' },
        { type: 'command_end', timestamp: '2026-01-01T00:00:01.000Z', exitCode: 1 },
      ],
    };
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.sessionStatus).toBe('denied');
    expect(report.valid).toBe(true);
    expect(report.events.bySeverity.error).toBe(2); // policy deny + guardrail deny
  });

  it('JSON output includes schemaVersion', () => {
    const session: Session = {
      id: 'schema-test',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:05:00.000Z',
      status: 'completed',
      command: 'echo test',
      profile: 'default',
      projectPath: '/tmp/project',
      exitCode: 0,
      events: [
        { type: 'command_start', timestamp: '2026-01-01T00:00:00.000Z', command: 'echo test' },
        { type: 'command_end', timestamp: '2026-01-01T00:05:00.000Z', exitCode: 0 },
      ],
    };
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    // Verify the JSON output has schemaVersion as the first key
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
  });
});
