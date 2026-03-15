import { describe, it, expect } from 'vitest';
import { claudeWrapper, shellEscape } from '../src/agents/claude.js';
import { getAgent, listAgents, getAgentNames } from '../src/agents/registry.js';

describe('shellEscape', () => {
  it('wraps simple strings in single quotes', () => {
    expect(shellEscape('hello world')).toBe("'hello world'");
  });

  it('escapes single quotes', () => {
    expect(shellEscape("it's a test")).toBe("'it'\\''s a test'");
  });

  it('handles multiple single quotes', () => {
    expect(shellEscape("it's a 'test'")).toBe("'it'\\''s a '\\''test'\\'''");
  });

  it('passes through double quotes unchanged', () => {
    expect(shellEscape('say "hello"')).toBe('\'say "hello"\'');
  });

  it('passes through backticks unchanged', () => {
    expect(shellEscape('run `command`')).toBe("'run `command`'");
  });

  it('passes through dollar signs unchanged', () => {
    expect(shellEscape('echo $HOME')).toBe("'echo $HOME'");
  });

  it('handles empty string', () => {
    expect(shellEscape('')).toBe("''");
  });

  it('handles newlines', () => {
    expect(shellEscape('line1\nline2')).toBe("'line1\nline2'");
  });

  it('handles backslashes', () => {
    expect(shellEscape('path\\to\\file')).toBe("'path\\to\\file'");
  });

  it('handles semicolons and pipes', () => {
    expect(shellEscape('a; b | c')).toBe("'a; b | c'");
  });
});

describe('claudeWrapper', () => {
  it('has correct name', () => {
    expect(claudeWrapper.name).toBe('claude');
  });

  it('has correct display name', () => {
    expect(claudeWrapper.displayName).toBe('Claude Code');
  });

  it('requires ANTHROPIC_API_KEY', () => {
    expect(claudeWrapper.requiredEnvVars).toContain('ANTHROPIC_API_KEY');
  });

  it('specifies claude binary', () => {
    expect(claudeWrapper.binary).toBe('claude');
  });

  describe('buildCommand', () => {
    it('builds correct command for simple prompt', () => {
      const cmd = claudeWrapper.buildCommand('fix all lint errors');
      expect(cmd).toBe("claude --dangerously-skip-permissions -p 'fix all lint errors'");
    });

    it('escapes single quotes in prompt', () => {
      const cmd = claudeWrapper.buildCommand("fix the user's profile page");
      expect(cmd).toBe("claude --dangerously-skip-permissions -p 'fix the user'\\''s profile page'");
    });

    it('preserves double quotes in prompt', () => {
      const cmd = claudeWrapper.buildCommand('add a "hello world" test');
      expect(cmd).toBe("claude --dangerously-skip-permissions -p 'add a \"hello world\" test'");
    });

    it('preserves shell metacharacters safely', () => {
      const cmd = claudeWrapper.buildCommand('fix $HOME/.config; rm -rf /');
      expect(cmd).toBe("claude --dangerously-skip-permissions -p 'fix $HOME/.config; rm -rf /'");
    });

    it('handles empty prompt', () => {
      const cmd = claudeWrapper.buildCommand('');
      expect(cmd).toBe("claude --dangerously-skip-permissions -p ''");
    });

    it('handles multiline prompt', () => {
      const cmd = claudeWrapper.buildCommand('fix errors\nadd tests');
      expect(cmd).toBe("claude --dangerously-skip-permissions -p 'fix errors\nadd tests'");
    });

    it('starts with claude binary name', () => {
      const cmd = claudeWrapper.buildCommand('any prompt');
      expect(cmd.startsWith('claude ')).toBe(true);
    });

    it('includes --dangerously-skip-permissions', () => {
      const cmd = claudeWrapper.buildCommand('any prompt');
      expect(cmd).toContain('--dangerously-skip-permissions');
    });

    it('includes -p flag', () => {
      const cmd = claudeWrapper.buildCommand('any prompt');
      expect(cmd).toContain(' -p ');
    });
  });
});

describe('registry', () => {
  describe('getAgent', () => {
    it('returns claude wrapper for "claude"', () => {
      const agent = getAgent('claude');
      expect(agent).toBeDefined();
      expect(agent!.name).toBe('claude');
    });

    it('returns undefined for unknown agent', () => {
      expect(getAgent('nonexistent')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getAgent('')).toBeUndefined();
    });
  });

  describe('listAgents', () => {
    it('returns non-empty array', () => {
      const agents = listAgents();
      expect(agents.length).toBeGreaterThan(0);
    });

    it('includes claude wrapper', () => {
      const agents = listAgents();
      expect(agents.some(a => a.name === 'claude')).toBe(true);
    });

    it('returns a new array each time (no mutation risk)', () => {
      const a = listAgents();
      const b = listAgents();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe('getAgentNames', () => {
    it('returns array of strings', () => {
      const names = getAgentNames();
      expect(names.length).toBeGreaterThan(0);
      expect(names.every(n => typeof n === 'string')).toBe(true);
    });

    it('includes claude', () => {
      expect(getAgentNames()).toContain('claude');
    });
  });
});
