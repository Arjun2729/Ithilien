import { describe, it, expect } from 'vitest';
import { createSession, computeSummary } from '../src/audit/session.js';
import type { Session } from '../src/types.js';

describe('session', () => {
  it('creates a session with correct defaults', () => {
    const session = createSession('echo test', 'default', '/tmp/project');
    expect(session.id).toHaveLength(12);
    expect(session.status).toBe('running');
    expect(session.command).toBe('echo test');
    expect(session.profile).toBe('default');
    expect(session.events).toHaveLength(0);
  });

  it('computes summary from events', () => {
    const session: Session = {
      id: 'test123',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:05:30.000Z',
      status: 'completed',
      command: 'echo test',
      profile: 'default',
      projectPath: '/tmp',
      exitCode: 0,
      events: [
        { type: 'command_start', timestamp: '2026-01-01T00:00:00.000Z', command: 'echo test' },
        { type: 'file_created', timestamp: '2026-01-01T00:01:00.000Z', path: 'new.ts', size: 100 },
        { type: 'file_modified', timestamp: '2026-01-01T00:02:00.000Z', path: 'old.ts', diff: '+added\n-removed\n+added2' },
        { type: 'file_deleted', timestamp: '2026-01-01T00:03:00.000Z', path: 'gone.ts' },
        { type: 'guardrail_triggered', timestamp: '2026-01-01T00:04:00.000Z', rule: 'network', action: 'block', detail: 'blocked evil.com' },
        { type: 'command_end', timestamp: '2026-01-01T00:05:30.000Z', exitCode: 0 },
      ],
    };

    const summary = computeSummary(session);
    expect(summary.duration).toBe(330); // 5m30s
    expect(summary.filesCreated).toBe(1);
    expect(summary.filesModified).toBe(1);
    expect(summary.filesDeleted).toBe(1);
    expect(summary.commandsExecuted).toBe(1);
    expect(summary.guardrailsTriggered).toBe(1);
    expect(summary.totalLinesAdded).toBe(2);
    expect(summary.totalLinesRemoved).toBe(1);
  });
});
