import { describe, it, expect } from 'vitest';
import { generateSummaryMarkdown } from '../src/integrity/summary.js';
import { generateVerificationReport } from '../src/integrity/report.js';
import { generateManifest } from '../src/integrity/manifest.js';
import { verifySession } from '../src/integrity/verifier.js';
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

const policyContext: PolicyContext = {
  sources: ['default-policy', 'project-policy'],
  policyHash: 'a'.repeat(64),
  engineVersion: '0.1.0',
  hashAlgorithm: 'sha256',
};

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: 'summary-test',
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

describe('generateSummaryMarkdown', () => {
  it('generates valid Markdown for a passing session', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);
    const md = generateSummaryMarkdown(report);

    expect(md).toContain('## Ithilien Verification Report');
    expect(md).toContain('| Session | `summary-test` |');
    expect(md).toContain('| Status | completed |');
    expect(md).toContain('| Integrity | Pass |');
    expect(md).toContain('| Events | 3 |');
  });

  it('shows FAIL for broken chain', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    // Tamper with an event after manifest generation
    (session.events[1] as { path: string }).path = 'HACKED.ts';
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);
    const md = generateSummaryMarkdown(report);

    expect(md).toContain('| Integrity | FAIL |');
    expect(md).toContain('**Chain broken at event 1.**');
  });

  it('includes policy section when context is present', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint, policyContext);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);
    const md = generateSummaryMarkdown(report);

    expect(md).toContain('### Policy');
    expect(md).toContain('| Sources | default-policy, project-policy |');
    expect(md).toContain(`| Hash | \`${'a'.repeat(64)}\` |`);
    expect(md).toContain('| Engine | 0.1.0 |');
  });

  it('omits policy section when context is absent', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);
    const md = generateSummaryMarkdown(report);

    expect(md).not.toContain('### Policy');
  });

  it('includes bundle metadata when provided', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);
    const md = generateSummaryMarkdown(report, {
      formatVersion: 1,
      bundledAt: '2026-02-01T00:00:00.000Z',
      bundledBy: '0.1.0',
    });

    expect(md).toContain('| Bundle Format | v1 |');
    expect(md).toContain('| Bundled At | 2026-02-01T00:00:00.000Z |');
    expect(md).toContain('| Bundled By | 0.1.0 |');
  });

  it('omits bundle metadata when not provided', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);
    const md = generateSummaryMarkdown(report);

    expect(md).not.toContain('Bundle Format');
    expect(md).not.toContain('Bundled At');
    expect(md).not.toContain('Bundled By');
  });

  it('handles denied session status', () => {
    const session = makeSession({
      status: 'denied',
      events: [
        { type: 'policy_decision', timestamp: '2026-01-01T00:00:00.000Z', command: 'rm -rf /', action: 'deny', risk: 'critical', category: 'filesystem', rule: 'rm-rf', source: 'default-policy', reason: 'blocked' },
        { type: 'command_start', timestamp: '2026-01-01T00:00:00.500Z', command: 'rm -rf /' },
        { type: 'command_end', timestamp: '2026-01-01T00:00:01.000Z', exitCode: 1 },
      ],
    });
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);
    const md = generateSummaryMarkdown(report);

    expect(md).toContain('| Status | denied |');
    expect(md).toContain('**Session was denied by policy enforcement.**');
  });

  it('contains no ANSI escape codes', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint, policyContext);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);
    const md = generateSummaryMarkdown(report);

    // ANSI escape codes start with \x1b[
    expect(md).not.toMatch(/\x1b\[/);
  });

  it('is deterministic (two calls produce identical output)', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint, policyContext);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);
    const md1 = generateSummaryMarkdown(report);
    const md2 = generateSummaryMarkdown(report);

    expect(md1).toBe(md2);
  });

  it('shows Ed25519 verified for signed sessions', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    // Simulate a signed session
    const report = generateVerificationReport(session, result);
    report.signature = { present: true, valid: true };
    const md = generateSummaryMarkdown(report);

    expect(md).toContain('| Signature | Ed25519 verified |');
  });

  it('shows INVALID for invalid signatures', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);
    report.signature = { present: true, valid: false };
    const md = generateSummaryMarkdown(report);

    expect(md).toContain('| Signature | INVALID |');
  });

  it('includes event breakdown by category', () => {
    const session = makeSession();
    session.manifest = generateManifest(session, fingerprint);
    const result = verifySession(session);
    const report = generateVerificationReport(session, result);
    const md = generateSummaryMarkdown(report);

    expect(md).toContain('### Event Breakdown');
    expect(md).toContain('| lifecycle | 2 |');
    expect(md).toContain('| filesystem | 1 |');
  });
});
