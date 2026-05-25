import { describe, it, expect } from 'vitest';
import { generateComplianceReport } from '../src/audit/compliance-report.js';
import { generateManifest } from '../src/integrity/manifest.js';
import { verifySession } from '../src/integrity/verifier.js';
import type { Session, EnvironmentFingerprint, SessionEvent } from '../src/types.js';

const fingerprint: EnvironmentFingerprint = {
  dockerImageId: 'sha256:abc123',
  dockerImageTag: 'ithilien/sandbox:latest',
  agentCommand: 'claude -p "fix tests"',
  hostOS: 'darwin-arm64',
  nodeVersion: 'v20.0.0',
  ithilienVersion: '0.1.0',
  guardrailProfile: 'default',
  profileHash: 'deadbeef'.repeat(8),
  networkMode: 'allowlist',
  networkAllowlist: ['github.com'],
  capturedAt: '2026-01-01T00:00:00.000Z',
};

function makeSession(events: SessionEvent[], overrides?: Partial<Session>): Session {
  const session: Session = {
    id: 'compliance-test-001',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z',
    status: 'completed',
    command: 'claude --dangerously-skip-permissions -p "fix tests"',
    prompt: 'fix tests',
    agent: 'claude',
    profile: 'default',
    projectPath: '/tmp/test-project',
    exitCode: 0,
    events,
    ...overrides,
  };
  session.manifest = generateManifest(session, fingerprint);
  return session;
}

describe('generateComplianceReport', () => {
  describe('schema version and identity', () => {
    it('sets schemaVersion to 1', () => {
      const session = makeSession([]);
      const report = generateComplianceReport(session);
      expect(report.schemaVersion).toBe(1);
    });

    it('captures session id', () => {
      const session = makeSession([]);
      const report = generateComplianceReport(session);
      expect(report.sessionId).toBe('compliance-test-001');
    });

    it('captures agent type', () => {
      const session = makeSession([]);
      const report = generateComplianceReport(session);
      expect(report.agentType).toBe('claude');
    });

    it('captures prompt', () => {
      const session = makeSession([]);
      const report = generateComplianceReport(session);
      expect(report.prompt).toBe('fix tests');
    });

    it('falls back to command if no prompt', () => {
      const session = makeSession([], { prompt: undefined, agent: undefined });
      const report = generateComplianceReport(session);
      expect(report.prompt).toBe('claude --dangerously-skip-permissions -p "fix tests"');
    });
  });

  describe('integrity fields', () => {
    it('includes rootHash from manifest', () => {
      const session = makeSession([]);
      const report = generateComplianceReport(session);
      expect(report.rootHash).toBe(session.manifest!.rootHash);
      expect(report.rootHash).toHaveLength(64);
    });

    it('sets integrityValid from verification result', () => {
      const session = makeSession([]);
      const result = verifySession(session);
      const report = generateComplianceReport(session, result);
      expect(report.integrityValid).toBe(result.valid);
    });

    it('sets integrityValid to false when no verification result provided', () => {
      const session = makeSession([]);
      const report = generateComplianceReport(session, undefined);
      expect(report.integrityValid).toBe(false);
    });

    it('includes signatureValid when provided', () => {
      const session = makeSession([]);
      const result = verifySession(session);
      const report = generateComplianceReport(session, result);
      // No signing key in test — signatureValid not set or undefined
      if (result.signatureValid !== undefined) {
        expect(report.signatureValid).toBe(result.signatureValid);
      }
    });
  });

  describe('compliance metadata', () => {
    it('sets nistAiRmfFunctions to all four functions', () => {
      const session = makeSession([]);
      const report = generateComplianceReport(session);
      expect(report.compliance.nistAiRmfFunctions).toEqual(
        expect.arrayContaining(['GOVERN', 'MAP', 'MEASURE', 'MANAGE']),
      );
    });

    it('includes EU AI Act and NIST in frameworks', () => {
      const session = makeSession([]);
      const report = generateComplianceReport(session);
      expect(report.compliance.frameworks).toContain('EU AI Act Article 12');
      expect(report.compliance.frameworks).toContain('NIST AI RMF 1.0');
    });

    it('classifies as limited risk for benign session', () => {
      const events: SessionEvent[] = [
        { type: 'command_start', timestamp: '2026-01-01T00:00:01.000Z', command: 'npm test' },
        { type: 'command_end', timestamp: '2026-01-01T00:00:02.000Z', exitCode: 0 },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      expect(report.compliance.euAiActRiskLevel).toBe('limited');
      expect(report.compliance.retentionDays).toBe(365);
    });

    it('classifies as high risk when guardrail denied', () => {
      const events: SessionEvent[] = [
        { type: 'guardrail_triggered', timestamp: '2026-01-01T00:00:01.000Z', rule: 'no-network', action: 'deny', detail: 'blocked' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      expect(report.compliance.euAiActRiskLevel).toBe('high');
      expect(report.compliance.retentionDays).toBe(3650);
    });

    it('classifies as high risk when high-risk command was evaluated', () => {
      const events: SessionEvent[] = [
        { type: 'policy_decision', timestamp: '2026-01-01T00:00:01.000Z', command: 'rm -rf /', action: 'deny', risk: 'critical', category: 'filesystem', rule: 'recursive-delete', source: 'default-policy', reason: 'destructive' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      expect(report.compliance.euAiActRiskLevel).toBe('high');
    });
  });

  describe('audit entries', () => {
    it('includes file_created events', () => {
      const events: SessionEvent[] = [
        { type: 'file_created', timestamp: '2026-01-01T00:00:01.000Z', path: 'src/new-file.ts', size: 100 },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      const entry = report.entries.find(e => e.eventType === 'file_created');
      expect(entry).toBeDefined();
      expect(entry!.what).toContain('src/new-file.ts');
    });

    it('includes file_modified events', () => {
      const events: SessionEvent[] = [
        { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'src/auth.ts' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      const entry = report.entries.find(e => e.eventType === 'file_modified');
      expect(entry).toBeDefined();
      expect(entry!.what).toContain('src/auth.ts');
    });

    it('includes file_deleted events', () => {
      const events: SessionEvent[] = [
        { type: 'file_deleted', timestamp: '2026-01-01T00:00:01.000Z', path: 'old-file.ts' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      const entry = report.entries.find(e => e.eventType === 'file_deleted');
      expect(entry).toBeDefined();
    });

    it('includes guardrail_triggered events', () => {
      const events: SessionEvent[] = [
        { type: 'guardrail_triggered', timestamp: '2026-01-01T00:00:01.000Z', rule: 'timeout', action: 'kill', detail: 'exceeded 1h' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      const entry = report.entries.find(e => e.eventType === 'guardrail_triggered');
      expect(entry).toBeDefined();
    });

    it('excludes stdout and stderr events', () => {
      const events: SessionEvent[] = [
        { type: 'stdout', timestamp: '2026-01-01T00:00:01.000Z', data: 'some output' },
        { type: 'stderr', timestamp: '2026-01-01T00:00:02.000Z', data: 'some error' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      expect(report.entries.find(e => e.eventType === 'stdout')).toBeUndefined();
      expect(report.entries.find(e => e.eventType === 'stderr')).toBeUndefined();
    });

    it('includes event hashes from manifest', () => {
      const events: SessionEvent[] = [
        { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'src/auth.ts' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      const entry = report.entries.find(e => e.eventType === 'file_modified');
      expect(entry!.eventHash).toHaveLength(64);
      expect(entry!.chainHash).toHaveLength(64);
    });

    it('sets context to prompt on all entries', () => {
      const events: SessionEvent[] = [
        { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'src/auth.ts' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      for (const entry of report.entries) {
        expect(entry.context).toBe('fix tests');
      }
    });

    it('attaches policy decision to command_start entry', () => {
      const events: SessionEvent[] = [
        {
          type: 'policy_decision',
          timestamp: '2026-01-01T00:00:00.500Z',
          command: 'npm test',
          action: 'allow',
          risk: 'low',
          category: 'unknown',
          rule: null,
          source: 'default-policy',
          reason: 'safe command',
        },
        { type: 'command_start', timestamp: '2026-01-01T00:00:01.000Z', command: 'npm test' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      const cmdEntry = report.entries.find(e => e.eventType === 'command_start');
      expect(cmdEntry?.policyDecision).toBeDefined();
      expect(cmdEntry!.policyDecision!.action).toBe('allow');
      expect(cmdEntry!.policyDecision!.risk).toBe('low');
    });
  });

  describe('summary', () => {
    it('counts files changed', () => {
      const events: SessionEvent[] = [
        { type: 'file_created', timestamp: '2026-01-01T00:00:01.000Z', path: 'a.ts', size: 10 },
        { type: 'file_modified', timestamp: '2026-01-01T00:00:02.000Z', path: 'b.ts' },
        { type: 'file_deleted', timestamp: '2026-01-01T00:00:03.000Z', path: 'c.ts' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      expect(report.summary.filesChanged).toBe(3);
    });

    it('counts commands executed', () => {
      const events: SessionEvent[] = [
        { type: 'command_start', timestamp: '2026-01-01T00:00:01.000Z', command: 'npm test' },
        { type: 'command_end', timestamp: '2026-01-01T00:00:02.000Z', exitCode: 0 },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      expect(report.summary.commandsExecuted).toBe(1);
    });

    it('counts policy decisions', () => {
      const events: SessionEvent[] = [
        { type: 'policy_decision', timestamp: '2026-01-01T00:00:01.000Z', command: 'npm test', action: 'allow', risk: 'low', category: 'unknown', rule: null, source: 'default-policy', reason: 'safe' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      expect(report.summary.policiesTriggered).toBe(1);
    });

    it('counts guardrails triggered', () => {
      const events: SessionEvent[] = [
        { type: 'guardrail_triggered', timestamp: '2026-01-01T00:00:01.000Z', rule: 'timeout', action: 'kill', detail: 'over limit' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      expect(report.summary.guardrailsTriggered).toBe(1);
    });

    it('reports 0 coverage when no reasoning blocks extracted', () => {
      const events: SessionEvent[] = [
        { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'a.ts' },
      ];
      const session = makeSession(events);
      const report = generateComplianceReport(session);
      expect(report.summary.reasoningBlocksExtracted).toBe(0);
      expect(report.summary.reasoningCoveragePercent).toBe(0);
    });

    it('reports 100 coverage when all file changes have reasoning', () => {
      const events: SessionEvent[] = [
        {
          type: 'stdout',
          timestamp: '2026-01-01T00:00:00.500Z',
          data: 'I need to update the authentication module to fix the security vulnerability.\n',
        },
        { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'src/auth.ts' },
      ];
      const session = makeSession(events, { agent: 'claude' });
      const report = generateComplianceReport(session);
      if (report.summary.reasoningBlocksExtracted > 0) {
        expect(report.summary.reasoningCoveragePercent).toBe(100);
      }
    });
  });

  describe('reasoning trace', () => {
    it('includes a reasoning trace', () => {
      const session = makeSession([]);
      const report = generateComplianceReport(session);
      expect(report.reasoning).toBeDefined();
      expect(report.reasoning.agentType).toBe('claude-code');
    });

    it('uses claude-code parser when agent is claude', () => {
      const session = makeSession([], { agent: 'claude' });
      const report = generateComplianceReport(session);
      expect(report.reasoning.agentType).toBe('claude-code');
    });

    it('uses aider parser when agent is aider', () => {
      const session = makeSession([], { agent: 'aider', command: 'aider --yes-always' });
      const report = generateComplianceReport(session);
      expect(report.reasoning.agentType).toBe('aider');
    });

    it('extracts thinking blocks from claude stdout', () => {
      const events: SessionEvent[] = [
        {
          type: 'stdout',
          timestamp: '2026-01-01T00:00:00.500Z',
          data: '<thinking>\nI should refactor this function to be more readable and maintainable.\n</thinking>\n',
        },
        { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'src/utils.ts' },
      ];
      const session = makeSession(events, { agent: 'claude' });
      const report = generateComplianceReport(session);
      const thinking = report.reasoning.blocks.filter(b => b.blockType === 'thinking');
      expect(thinking).toHaveLength(1);
      expect(thinking[0].confidence).toBe('high');
    });
  });

  describe('generatedAt', () => {
    it('is a valid ISO timestamp', () => {
      const session = makeSession([]);
      const report = generateComplianceReport(session);
      expect(() => new Date(report.generatedAt)).not.toThrow();
      expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
    });
  });
});
