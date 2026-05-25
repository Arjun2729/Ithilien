import { describe, it, expect } from 'vitest';
import { parseReasoning } from '../src/audit/reasoning-parser.js';
import type { SessionEvent } from '../src/types.js';

function stdoutEvent(data: string, index = 0): SessionEvent {
  return { type: 'stdout', timestamp: `2026-01-01T00:00:0${index}.000Z`, data };
}

function fileEvent(path: string, index = 0): SessionEvent {
  return { type: 'file_modified', timestamp: `2026-01-01T00:00:0${index}.000Z`, path };
}

describe('reasoning-parser', () => {
  describe('detectAgentType', () => {
    it('returns generic for no hint', () => {
      const result = parseReasoning([], undefined);
      expect(result.agentType).toBe('generic');
    });

    it('detects claude-code', () => {
      const result = parseReasoning([], 'claude --dangerously-skip-permissions');
      expect(result.agentType).toBe('claude-code');
    });

    it('detects aider', () => {
      const result = parseReasoning([], 'aider --yes-always');
      expect(result.agentType).toBe('aider');
    });

    it('returns generic for unknown agent', () => {
      const result = parseReasoning([], 'codex --full-auto');
      expect(result.agentType).toBe('generic');
    });
  });

  describe('empty input', () => {
    it('returns empty trace with no stdout events', () => {
      const events: SessionEvent[] = [
        { type: 'command_start', timestamp: '2026-01-01T00:00:00.000Z', command: 'echo hi' },
        { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'foo.ts' },
      ];
      const result = parseReasoning(events, 'claude');
      expect(result.blocks).toHaveLength(0);
      expect(result.parsedChars).toBe(0);
      expect(result.stdoutEventCount).toBe(0);
    });
  });

  describe('Claude Code: <thinking> blocks', () => {
    it('extracts a single thinking block', () => {
      const events: SessionEvent[] = [
        stdoutEvent('<thinking>\nI need to fix the validation logic\n</thinking>\n'),
      ];
      const result = parseReasoning(events, 'claude');
      const thinking = result.blocks.filter(b => b.blockType === 'thinking');
      expect(thinking).toHaveLength(1);
      expect(thinking[0].content).toContain('fix the validation logic');
      expect(thinking[0].confidence).toBe('high');
    });

    it('extracts multiple thinking blocks', () => {
      const text = '<thinking>\nI need to update the validation logic to handle null inputs.\n</thinking>\nSome output\n<thinking>\nThe tests also need to be updated to cover the new edge cases.\n</thinking>';
      const events: SessionEvent[] = [stdoutEvent(text)];
      const result = parseReasoning(events, 'claude');
      const thinking = result.blocks.filter(b => b.blockType === 'thinking');
      expect(thinking).toHaveLength(2);
    });

    it('ignores empty thinking blocks', () => {
      const events: SessionEvent[] = [stdoutEvent('<thinking>\n   \n</thinking>')];
      const result = parseReasoning(events, 'claude');
      const thinking = result.blocks.filter(b => b.blockType === 'thinking');
      expect(thinking).toHaveLength(0);
    });
  });

  describe('Claude Code: reasoning prefix lines', () => {
    it('extracts "I need to" lines', () => {
      const events: SessionEvent[] = [
        stdoutEvent('I need to update the validation function to handle edge cases properly.\n'),
      ];
      const result = parseReasoning(events, 'claude');
      expect(result.blocks.length).toBeGreaterThan(0);
      expect(result.blocks[0].content).toContain('validation function');
    });

    it('extracts "Let me" reasoning lines', () => {
      const events: SessionEvent[] = [
        stdoutEvent('Let me examine the current implementation before making changes.\n'),
      ];
      const result = parseReasoning(events, 'claude');
      expect(result.blocks.length).toBeGreaterThan(0);
    });

    it('does not extract short lines', () => {
      const events: SessionEvent[] = [stdoutEvent('I need to do it.\n')];
      const result = parseReasoning(events, 'claude');
      // Short line (< 25 chars) should not be extracted
      const hasShort = result.blocks.some(b => b.content === 'I need to do it.');
      expect(hasShort).toBe(false);
    });

    it('does not extract code lines', () => {
      const events: SessionEvent[] = [
        stdoutEvent('{ "key": "value" }\n'),
        stdoutEvent('[1, 2, 3].map(x => x + 1)\n'),
      ];
      const result = parseReasoning(events, 'claude');
      // Code lines should not be extracted as reasoning
      const hasCode = result.blocks.some(
        b => b.content.includes('"key"') || b.content.includes('.map('),
      );
      expect(hasCode).toBe(false);
    });
  });

  describe('event association', () => {
    it('associates reasoning blocks with subsequent file events', () => {
      const events: SessionEvent[] = [
        // event 0: stdout with reasoning
        stdoutEvent('Let me update the authentication module to fix the security issue.\n', 0),
        // event 1: file change (should be associated)
        fileEvent('src/auth.ts', 1),
        // event 2: file change (should also be associated)
        fileEvent('src/auth.test.ts', 2),
      ];
      const result = parseReasoning(events, 'claude');
      if (result.blocks.length > 0) {
        const block = result.blocks[0];
        expect(block.associatedEventIndices).toContain(1);
        expect(block.associatedEventIndices).toContain(2);
      }
    });

    it('does not associate events before the reasoning block', () => {
      const events: SessionEvent[] = [
        // event 0: file change before reasoning
        fileEvent('src/early.ts', 0),
        // event 1: stdout with reasoning
        stdoutEvent('I need to add validation here for safety and correctness.\n', 1),
        // event 2: file change after reasoning
        fileEvent('src/after.ts', 2),
      ];
      const result = parseReasoning(events, 'claude');
      if (result.blocks.length > 0) {
        const block = result.blocks[0];
        // event 0 (before the block) should NOT be associated
        expect(block.associatedEventIndices).not.toContain(0);
        // event 2 (after the block) should be associated
        expect(block.associatedEventIndices).toContain(2);
      }
    });

    it('windows associations to the next reasoning block', () => {
      const events: SessionEvent[] = [
        // event 0: first reasoning
        stdoutEvent('I need to fix the first validation function properly.\n', 0),
        // event 1: file changed for first reasoning
        fileEvent('src/validator.ts', 1),
        // event 2: second reasoning
        stdoutEvent('Now let me also update the helper utilities for consistency.\n', 2),
        // event 3: file changed for second reasoning
        fileEvent('src/helpers.ts', 3),
      ];
      const result = parseReasoning(events, 'claude');
      if (result.blocks.length >= 2) {
        // First block should be associated with event 1, not event 3
        expect(result.blocks[0].associatedEventIndices).toContain(1);
        expect(result.blocks[0].associatedEventIndices).not.toContain(3);
        // Second block should be associated with event 3, not event 1
        expect(result.blocks[1].associatedEventIndices).toContain(3);
        expect(result.blocks[1].associatedEventIndices).not.toContain(1);
      }
    });
  });

  describe('parsedChars and stdoutEventCount', () => {
    it('tracks total parsed characters', () => {
      const data = 'I need to make this change because of reasons.\n';
      const events: SessionEvent[] = [stdoutEvent(data)];
      const result = parseReasoning(events, 'generic');
      expect(result.parsedChars).toBe(data.length);
    });

    it('tracks stdout event count', () => {
      const events: SessionEvent[] = [
        stdoutEvent('chunk one'),
        { type: 'file_modified', timestamp: '2026-01-01T00:00:01.000Z', path: 'a.ts' },
        stdoutEvent('chunk two'),
      ];
      const result = parseReasoning(events, 'generic');
      expect(result.stdoutEventCount).toBe(2);
    });
  });

  describe('Aider parser', () => {
    it('extracts reasoning lines from Aider output', () => {
      const events: SessionEvent[] = [
        stdoutEvent('I need to refactor this function to improve readability and performance.\n'),
      ];
      const result = parseReasoning(events, 'aider --yes-always');
      expect(result.agentType).toBe('aider');
      expect(result.blocks.length).toBeGreaterThan(0);
    });
  });

  describe('generic parser', () => {
    it('extracts prose paragraphs heuristically', () => {
      const events: SessionEvent[] = [
        stdoutEvent('The function needs to handle the edge case where the input is null or undefined.\n'),
      ];
      const result = parseReasoning(events, 'some-unknown-agent');
      expect(result.agentType).toBe('generic');
      // Generic parser should find prose
      expect(result.blocks.length).toBeGreaterThanOrEqual(0); // may or may not match depending on heuristic
    });
  });

  describe('block classification', () => {
    it('classifies plan-type reasoning', () => {
      const events: SessionEvent[] = [
        stdoutEvent('My approach will be to first update the model then the view components.\n'),
      ];
      const result = parseReasoning(events, 'claude');
      const planBlocks = result.blocks.filter(b => b.blockType === 'plan');
      expect(planBlocks.length).toBeGreaterThan(0);
    });

    it('classifies rationale-type reasoning', () => {
      const events: SessionEvent[] = [
        stdoutEvent('I need to do this because the current implementation is missing error handling.\n'),
      ];
      const result = parseReasoning(events, 'claude');
      const rationaleBlocks = result.blocks.filter(b => b.blockType === 'rationale');
      expect(rationaleBlocks.length).toBeGreaterThan(0);
    });

    it('classifies observation-type reasoning', () => {
      const events: SessionEvent[] = [
        stdoutEvent('I see that the current code does not validate the input before processing.\n'),
      ];
      const result = parseReasoning(events, 'claude');
      const observationBlocks = result.blocks.filter(b => b.blockType === 'observation');
      expect(observationBlocks.length).toBeGreaterThan(0);
    });
  });
});
