import { describe, it, expect } from 'vitest';
import { parseSidecarContent, parseReasoning } from '../src/audit/reasoning-parser.js';
import type { SessionEvent } from '../src/types.js';

// ─── parseSidecarContent ──────────────────────────────────────────────────────

describe('parseSidecarContent', () => {
  it('parses a single valid reasoning line', () => {
    const jsonl = JSON.stringify({
      type: 'reasoning',
      content: 'The auth token needs expiry validation',
      intent: 'fix security vulnerability',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const events = parseSidecarContent(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe('The auth token needs expiry validation');
    expect(events[0].intent).toBe('fix security vulnerability');
    expect(events[0].timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(events[0].type).toBe('reasoning');
  });

  it('parses multiple lines', () => {
    const lines = [
      JSON.stringify({ type: 'reasoning', content: 'First reasoning', intent: 'first intent', timestamp: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ type: 'reasoning', content: 'Second reasoning', intent: 'second intent', timestamp: '2026-01-01T00:00:01.000Z' }),
    ].join('\n');
    const events = parseSidecarContent(lines);
    expect(events).toHaveLength(2);
    expect(events[0].content).toBe('First reasoning');
    expect(events[1].content).toBe('Second reasoning');
  });

  it('skips blank lines', () => {
    const jsonl = '\n\n' + JSON.stringify({ type: 'reasoning', content: 'Valid', intent: 'test', timestamp: '2026-01-01T00:00:00.000Z' }) + '\n\n';
    expect(parseSidecarContent(jsonl)).toHaveLength(1);
  });

  it('skips malformed JSON lines', () => {
    const jsonl = [
      'not json at all',
      JSON.stringify({ type: 'reasoning', content: 'Valid', intent: 'ok', timestamp: '2026-01-01T00:00:00.000Z' }),
      '{broken json}',
    ].join('\n');
    const events = parseSidecarContent(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe('Valid');
  });

  it('skips lines without type=reasoning', () => {
    const jsonl = [
      JSON.stringify({ type: 'other', content: 'Not reasoning', intent: 'x', timestamp: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ type: 'reasoning', content: 'Is reasoning', intent: 'y', timestamp: '2026-01-01T00:00:00.000Z' }),
    ].join('\n');
    const events = parseSidecarContent(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe('Is reasoning');
  });

  it('skips lines without a string content field', () => {
    const jsonl = JSON.stringify({ type: 'reasoning', content: 123, intent: 'x', timestamp: '2026-01-01T00:00:00.000Z' });
    expect(parseSidecarContent(jsonl)).toHaveLength(0);
  });

  it('defaults intent to empty string if missing', () => {
    const jsonl = JSON.stringify({ type: 'reasoning', content: 'some content', timestamp: '2026-01-01T00:00:00.000Z' });
    const events = parseSidecarContent(jsonl);
    expect(events[0].intent).toBe('');
  });

  it('defaults timestamp if missing', () => {
    const jsonl = JSON.stringify({ type: 'reasoning', content: 'some content', intent: 'test' });
    const events = parseSidecarContent(jsonl);
    expect(events[0].timestamp).toBeTruthy();
    expect(() => new Date(events[0].timestamp)).not.toThrow();
  });

  it('returns empty array for empty input', () => {
    expect(parseSidecarContent('')).toHaveLength(0);
  });
});

// ─── parseReasoning with sidecar events ──────────────────────────────────────

describe('parseReasoning with reasoning_sidecar events', () => {
  it('prefers sidecar events over stdout heuristics', () => {
    const events: SessionEvent[] = [
      // stdout with parseable heuristic reasoning
      { type: 'stdout', timestamp: '2026-01-01T00:00:00.000Z', data: 'I need to fix the validation in this module.\n' },
      // sidecar event (should take priority)
      { type: 'reasoning_sidecar', timestamp: '2026-01-01T00:00:00.500Z', content: 'Sidecar reasoning', intent: 'sidecar intent' },
      { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'src/auth.ts' },
    ];

    const result = parseReasoning(events, 'claude');
    // Should use sidecar path, not stdout heuristics
    expect(result.blocks).toHaveLength(1);
    // Sidecar block combines intent and content
    expect(result.blocks[0].content).toContain('Sidecar reasoning');
    expect(result.blocks[0].confidence).toBe('high');
    // Sidecar-derived trace has parsedChars = 0 (no stdout processing)
    expect(result.parsedChars).toBe(0);
    expect(result.stdoutEventCount).toBe(0);
  });

  it('falls back to stdout parsing when no sidecar events', () => {
    const events: SessionEvent[] = [
      { type: 'stdout', timestamp: '2026-01-01T00:00:00.000Z', data: 'I need to fix the validation module for correctness.\n' },
      { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'src/auth.ts' },
    ];
    const result = parseReasoning(events, 'claude');
    // Falls back to stdout heuristics
    expect(result.parsedChars).toBeGreaterThan(0);
    expect(result.stdoutEventCount).toBe(1);
  });

  it('associates sidecar blocks with subsequent file events', () => {
    const events: SessionEvent[] = [
      // event 0
      { type: 'reasoning_sidecar', timestamp: '2026-01-01T00:00:00.000Z', content: 'Fixing auth', intent: 'security fix' },
      // event 1
      { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'src/auth.ts' },
      // event 2
      { type: 'file_modified', timestamp: '2026-01-01T00:00:02.000Z', path: 'src/auth.test.ts' },
    ];
    const result = parseReasoning(events, 'claude');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].associatedEventIndices).toContain(1);
    expect(result.blocks[0].associatedEventIndices).toContain(2);
  });

  it('windows sidecar associations correctly between blocks', () => {
    const events: SessionEvent[] = [
      // event 0: first sidecar block
      { type: 'reasoning_sidecar', timestamp: '2026-01-01T00:00:00.000Z', content: 'First fix', intent: 'fix auth' },
      // event 1: associated with first block
      { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'src/auth.ts' },
      // event 2: second sidecar block
      { type: 'reasoning_sidecar', timestamp: '2026-01-01T00:00:02.000Z', content: 'Second fix', intent: 'fix tests' },
      // event 3: associated with second block
      { type: 'file_modified', timestamp: '2026-01-01T00:00:03.000Z', path: 'src/auth.test.ts' },
    ];
    const result = parseReasoning(events, 'claude');
    expect(result.blocks).toHaveLength(2);
    // First block → only event 1
    expect(result.blocks[0].associatedEventIndices).toContain(1);
    expect(result.blocks[0].associatedEventIndices).not.toContain(3);
    // Second block → only event 3
    expect(result.blocks[1].associatedEventIndices).toContain(3);
    expect(result.blocks[1].associatedEventIndices).not.toContain(1);
  });

  it('sidecar blocks have confidence: high', () => {
    const events: SessionEvent[] = [
      { type: 'reasoning_sidecar', timestamp: '2026-01-01T00:00:00.000Z', content: 'Some reasoning here', intent: 'some intent' },
    ];
    const result = parseReasoning(events, 'claude');
    expect(result.blocks.every(b => b.confidence === 'high')).toBe(true);
  });

  it('includes intent in content when intent is non-empty', () => {
    const events: SessionEvent[] = [
      { type: 'reasoning_sidecar', timestamp: '2026-01-01T00:00:00.000Z', content: 'The function is missing null checks', intent: 'prevent NPE crashes' },
    ];
    const result = parseReasoning(events, 'claude');
    expect(result.blocks[0].content).toContain('prevent NPE crashes');
    expect(result.blocks[0].content).toContain('The function is missing null checks');
  });

  it('handles empty sidecar event list gracefully', () => {
    // Session with only non-sidecar events — should not trigger sidecar path
    const events: SessionEvent[] = [
      { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'src/auth.ts' },
    ];
    const result = parseReasoning(events, 'claude');
    expect(result.blocks).toBeDefined();
    expect(Array.isArray(result.blocks)).toBe(true);
  });

  it('preserves agentType from hint even in sidecar path', () => {
    const events: SessionEvent[] = [
      { type: 'reasoning_sidecar', timestamp: '2026-01-01T00:00:00.000Z', content: 'Fix it', intent: 'fix' },
    ];
    expect(parseReasoning(events, 'claude').agentType).toBe('claude-code');
    expect(parseReasoning(events, 'aider').agentType).toBe('aider');
    expect(parseReasoning(events, undefined).agentType).toBe('generic');
  });
});


// Direct tests of injectSidecarSystemPrompt without nested describe
describe('injectSidecarSystemPrompt (direct)', () => {
  it('injects --system-prompt before -p flag in claude command', async () => {
    const { injectSidecarSystemPrompt } = await import('../src/agents/claude.js');
    const cmd = "claude --dangerously-skip-permissions -p 'fix tests'";
    const result = injectSidecarSystemPrompt(cmd);
    expect(result).toContain('--system-prompt');
    expect(result.indexOf('--system-prompt')).toBeLessThan(result.indexOf(' -p '));
  });

  it('does not modify non-claude commands', async () => {
    const { injectSidecarSystemPrompt } = await import('../src/agents/claude.js');
    const cmd = "aider --yes-always 'refactor auth'";
    expect(injectSidecarSystemPrompt(cmd)).toBe(cmd);
  });

  it('does not inject if --system-prompt already present', async () => {
    const { injectSidecarSystemPrompt } = await import('../src/agents/claude.js');
    const cmd = "claude --system-prompt 'existing prompt' -p 'fix tests'";
    const result = injectSidecarSystemPrompt(cmd);
    const count = (result.match(/--system-prompt/g) || []).length;
    expect(count).toBe(1);
  });

  it('falls back to appending when no -p flag found', async () => {
    const { injectSidecarSystemPrompt } = await import('../src/agents/claude.js');
    const cmd = 'claude --dangerously-skip-permissions';
    const result = injectSidecarSystemPrompt(cmd);
    expect(result).toContain('--system-prompt');
  });

  it('SIDECAR_SYSTEM_PROMPT mentions the sidecar file path', async () => {
    const { SIDECAR_SYSTEM_PROMPT } = await import('../src/agents/claude.js');
    expect(SIDECAR_SYSTEM_PROMPT).toContain('/tmp/ithilien-reasoning.jsonl');
  });

  it('SIDECAR_SYSTEM_PROMPT includes the JSON schema fields', async () => {
    const { SIDECAR_SYSTEM_PROMPT } = await import('../src/agents/claude.js');
    expect(SIDECAR_SYSTEM_PROMPT).toContain('reasoning');
    expect(SIDECAR_SYSTEM_PROMPT).toContain('content');
    expect(SIDECAR_SYSTEM_PROMPT).toContain('intent');
  });
});
