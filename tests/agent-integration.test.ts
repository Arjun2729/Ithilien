import { describe, it, expect } from 'vitest';
import { getAgent } from '../src/agents/registry.js';
import { evaluateCommand } from '../src/policy/evaluator.js';
import { DEFAULT_POLICY } from '../src/policy/defaults.js';
import type { Session } from '../src/types.js';

describe('agent wrapper integration', () => {
  it('expanded command is processable by the policy evaluator', () => {
    const wrapper = getAgent('claude')!;
    const cmd = wrapper.buildCommand('fix lint errors');

    const decision = evaluateCommand(cmd, DEFAULT_POLICY);
    expect(decision).toHaveProperty('action');
    expect(decision).toHaveProperty('risk');
    expect(decision).toHaveProperty('category');
  });

  it('Session type accepts prompt and agent fields', () => {
    const session: Session = {
      id: 'test123',
      startedAt: new Date().toISOString(),
      status: 'completed',
      command: "claude --dangerously-skip-permissions -p 'fix lint errors'",
      prompt: 'fix lint errors',
      agent: 'claude',
      profile: 'default',
      projectPath: '/tmp/test',
      events: [],
    };

    expect(session.command).toContain('claude --dangerously-skip-permissions');
    expect(session.prompt).toBe('fix lint errors');
    expect(session.agent).toBe('claude');
  });

  it('Session without agent wrapper has no prompt field', () => {
    const session: Session = {
      id: 'test456',
      startedAt: new Date().toISOString(),
      status: 'completed',
      command: 'npm install',
      profile: 'default',
      projectPath: '/tmp/test',
      events: [],
    };

    expect(session.prompt).toBeUndefined();
    expect(session.agent).toBeUndefined();
  });
});
