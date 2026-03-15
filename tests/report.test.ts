import { describe, it, expect } from 'vitest';
import { generateVerificationReport } from '../src/integrity/report.js';
import { generateManifest } from '../src/integrity/manifest.js';
import { verifySession } from '../src/integrity/verifier.js';
import type { Session, EnvironmentFingerprint, PolicyContext, VerificationResult } from '../src/types.js';

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

const policyContext: PolicyContext = {
  sources: ['default-policy', 'project-policy'],
  policyHash: 'a'.repeat(64),
  engineVersion: '0.1.0',
};

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: 'report-test',
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
    ...overrides,
  };
}

describe('generateVerificationReport', () => {
  it('generates a valid report for a verified session', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint, policyContext);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.valid).toBe(true);
    expect(report.sessionId).toBe('report-test');
    expect(report.sessionStatus).toBe('completed');
    expect(report.chain.intact).toBe(true);
    expect(report.chain.eventCount).toBe(3);
    expect(report.chain).not.toHaveProperty('brokenAt');
    expect(report.details).toContain('verified');
  });

  it('includes event counts by type, category, and severity', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.events.total).toBe(3);
    expect(report.events.byType).toEqual({
      command_start: 1,
      file_created: 1,
      command_end: 1,
    });
    expect(report.events.byCategory).toEqual({
      lifecycle: 2,
      filesystem: 1,
    });
    expect(report.events.bySeverity).toEqual({
      info: 3,
    });
  });

  it('includes policy context when present in manifest', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint, policyContext);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.policy).toBeDefined();
    expect(report.policy!.sources).toEqual(['default-policy', 'project-policy']);
    expect(report.policy!.policyHash).toBe('a'.repeat(64));
    expect(report.policy!.engineVersion).toBe('0.1.0');
  });

  it('omits policy context when absent from manifest', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report).not.toHaveProperty('policy');
  });

  it('includes policyPath when present in context', () => {
    const ctxWithPath: PolicyContext = { ...policyContext, policyPath: '/custom/policy.json' };
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint, ctxWithPath);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.policy!.policyPath).toBe('/custom/policy.json');
  });

  it('reports signature as not present when unsigned', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.signature.present).toBe(false);
    expect(report.signature).not.toHaveProperty('valid');
  });

  it('reports environment from fingerprint', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.environment.dockerImageTag).toBe('ithilien/sandbox:latest');
    expect(report.environment.guardrailProfile).toBe('default');
    expect(report.environment.networkMode).toBe('allowlist');
    expect(report.environment.ithilienVersion).toBe('0.1.0');
  });

  it('reports timing from manifest', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.timing.firstEvent).toBe('2026-01-01T00:00:00.000Z');
    expect(report.timing.lastEvent).toBe('2026-01-01T00:05:00.000Z');
  });

  it('handles invalid session with broken chain', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    // Tamper with an event
    (session.events[1] as { path: string }).path = 'HACKED.ts';
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.valid).toBe(false);
    expect(report.chain.intact).toBe(false);
    expect(report.chain.brokenAt).toBe(1);
  });

  it('captures denied session status', () => {
    const session = makeSession({
      status: 'denied',
      exitCode: 1,
      events: [
        { type: 'policy_decision', timestamp: '2026-01-01T00:00:00.000Z', command: 'rm -rf /', action: 'deny', risk: 'critical', category: 'filesystem', rule: 'recursive-force-delete', source: 'default-policy', reason: 'blocked' },
        { type: 'command_start', timestamp: '2026-01-01T00:00:01.000Z', command: 'rm -rf /' },
        { type: 'guardrail_triggered', timestamp: '2026-01-01T00:00:01.000Z', rule: 'recursive-force-delete', action: 'deny', detail: 'blocked' },
        { type: 'command_end', timestamp: '2026-01-01T00:00:01.000Z', exitCode: 1 },
      ],
    });
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.valid).toBe(true);
    expect(report.sessionStatus).toBe('denied');
    expect(report.events.byType.policy_decision).toBe(1);
    expect(report.events.byCategory.policy).toBe(1);
    expect(report.events.bySeverity.error).toBe(2); // policy deny + guardrail deny
  });

  it('includes schemaVersion field', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.schemaVersion).toBe(1);
  });

  it('includes hashAlgorithm in policy when present in context', () => {
    const ctxWithAlgo: PolicyContext = { ...policyContext, hashAlgorithm: 'sha256' };
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint, ctxWithAlgo);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);

    expect(report.policy!.hashAlgorithm).toBe('sha256');
  });

  it('produces deterministic output', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint, policyContext);
    const result = verifySession(session);

    const report1 = generateVerificationReport(session, result);
    const report2 = generateVerificationReport(session, result);

    expect(JSON.stringify(report1)).toBe(JSON.stringify(report2));
  });
});
