/**
 * Reasoning parser — extracts structured reasoning traces from agent stdout
 * or from the structured sidecar file (/tmp/ithilien-reasoning.jsonl).
 *
 * Priority order (highest to lowest):
 * 1. reasoning_sidecar events in the session (written directly by the agent,
 *    structured, high confidence — preferred when present and non-empty)
 * 2. Claude Code <thinking>...</thinking> blocks (extended thinking, high confidence)
 * 3. Reasoning-prefix lines heuristic (medium confidence)
 * 4. Generic prose heuristic (low confidence, fallback)
 *
 * Association strategy: a reasoning block is associated with file events that
 * occur after it in the event timeline and before the next reasoning block.
 * This mirrors how agents work: they reason, then act.
 */

import type { SessionEvent } from '../types.js';
import type { ReasoningBlock, ReasoningTrace, AgentType, ReasoningBlockType } from './schema.js';

// ─── Sidecar ─────────────────────────────────────────────────────────────────

/**
 * A single structured reasoning event from the sidecar JSONL file.
 * Schema: { "type": "reasoning", "content": string, "intent": string, "timestamp": string }
 */
export interface SidecarReasoningEvent {
  type: 'reasoning';
  content: string;
  intent: string;
  timestamp: string;
}

/**
 * Parse the contents of /tmp/ithilien-reasoning.jsonl.
 * Each line is a JSON object; malformed lines are silently skipped.
 */
export function parseSidecarContent(jsonl: string): SidecarReasoningEvent[] {
  const events: SidecarReasoningEvent[] = [];
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj['type'] === 'reasoning' && typeof obj['content'] === 'string') {
        events.push({
          type: 'reasoning',
          content: obj['content'],
          intent: typeof obj['intent'] === 'string' ? obj['intent'] : '',
          timestamp: typeof obj['timestamp'] === 'string'
            ? obj['timestamp']
            : new Date().toISOString(),
        });
      }
    } catch { /* skip malformed lines */ }
  }
  return events;
}

/**
 * Build a ReasoningTrace from reasoning_sidecar session events.
 * Used when sidecar data is available — higher fidelity than stdout heuristics.
 */
function parseFromSidecarEvents(
  events: SessionEvent[],
  agentHint: string | undefined,
): ReasoningTrace {
  const agentType = detectAgentType(agentHint);
  const sidecarEvents = events.filter(
    (e): e is Extract<SessionEvent, { type: 'reasoning_sidecar' }> =>
      e.type === 'reasoning_sidecar',
  );

  const FILE_TYPES = new Set(['file_created', 'file_modified', 'file_deleted']);

  // Build blocks from sidecar events in session order
  // Associate each block with file events between this sidecar event and the next
  const blocks: ReasoningBlock[] = sidecarEvents.map((ev, si) => {
    // Find this sidecar event's index in the full event array
    const evIdx = events.indexOf(ev);
    // Next sidecar event's index (or end of session)
    const nextSidecarIdx = si + 1 < sidecarEvents.length
      ? events.indexOf(sidecarEvents[si + 1])
      : events.length;

    const associated: number[] = [];
    for (let i = evIdx + 1; i < nextSidecarIdx; i++) {
      if (FILE_TYPES.has(events[i].type)) associated.push(i);
    }

    return {
      blockType: ev.intent ? 'rationale' : 'generic',
      content: ev.intent ? `${ev.intent}: ${ev.content}` : ev.content,
      confidence: 'high' as const,
      associatedEventIndices: associated,
    };
  });

  return {
    agentType,
    blocks,
    parsedChars: 0,
    stdoutEventCount: 0,
  };
}

/** Lines starting with these patterns are likely reasoning */
const REASONING_PREFIXES: RegExp[] = [
  /^(?:I need to|I'll|I will|I am going to|I'm going to|Let me|I should|I must|I have to)\b/i,
  /^(?:My approach|The approach|My plan|The plan|First,?\s+I|Now I|Next,?\s+I|To fix|To implement|To add|To change|To update|To create|To remove|To make)\b/i,
  /^(?:The reason|This is because|This will|This should|This needs to|The goal|The issue|The problem)\b/i,
  /^(?:Looking at|Examining|I see that|I notice that|I observe|The file|The code|The function|The class|I found|I can see)\b/i,
];

/** Lines that are almost certainly code, not reasoning */
const CODE_LINE_RE = /^[{}\[\]()=>|<`;\\#*@]/;
const MIN_REASONING_LENGTH = 25;
const MAX_REASONING_LENGTH = 1000;

interface ChunkBoundary {
  start: number;
  end: number;
  eventIndex: number;
}

/**
 * Parse reasoning from session events.
 *
 * Prefers reasoning_sidecar events (written directly by the agent) over
 * heuristic stdout parsing. Falls back to stdout when no sidecar events exist.
 *
 * @param events     Full session event list
 * @param agentHint  Agent name hint for parser selection (e.g. 'claude', 'aider')
 */
export function parseReasoning(
  events: SessionEvent[],
  agentHint?: string,
): ReasoningTrace {
  // Prefer sidecar events — higher fidelity than stdout heuristics
  const hasSidecar = events.some(e => e.type === 'reasoning_sidecar');
  if (hasSidecar) {
    return parseFromSidecarEvents(events, agentHint);
  }

  const agentType = detectAgentType(agentHint);

  // Collect stdout chunks in event order with their session event indices
  const stdoutChunks: Array<{ data: string; eventIndex: number }> = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'stdout' && ev.data.length > 0) {
      stdoutChunks.push({ data: ev.data, eventIndex: i });
    }
  }

  if (stdoutChunks.length === 0) {
    return { agentType, blocks: [], parsedChars: 0, stdoutEventCount: 0 };
  }

  // Build full concatenated stdout with chunk boundaries for offset-to-event mapping
  let fullText = '';
  const chunkBoundaries: ChunkBoundary[] = [];
  for (const chunk of stdoutChunks) {
    const start = fullText.length;
    fullText += chunk.data;
    chunkBoundaries.push({ start, end: fullText.length, eventIndex: chunk.eventIndex });
  }

  // Extract reasoning blocks using agent-appropriate parser
  let blocks: ReasoningBlock[];
  switch (agentType) {
    case 'claude-code':
      blocks = parseClaudeCode(fullText);
      break;
    case 'aider':
      blocks = parseAider(fullText);
      break;
    default:
      blocks = parseGeneric(fullText);
  }

  // Associate each block with the file/command events it motivated
  associateBlocksWithEvents(blocks, events, chunkBoundaries);

  return {
    agentType,
    blocks,
    parsedChars: fullText.length,
    stdoutEventCount: stdoutChunks.length,
  };
}

/**
 * Claude Code parser.
 *
 * Extracts two types of reasoning:
 * 1. <thinking>...</thinking> blocks (extended thinking, confidence: high)
 * 2. Reasoning-prefix lines ("I'll...", "Let me...", etc.) (confidence: medium)
 */
function parseClaudeCode(text: string): ReasoningBlock[] {
  const blocks: ReasoningBlock[] = [];

  // 1. Extended thinking blocks — highest signal
  const thinkingRe = /<thinking>([\s\S]*?)<\/thinking>/gi;
  let m: RegExpExecArray | null;
  while ((m = thinkingRe.exec(text)) !== null) {
    const content = m[1].trim();
    if (content.length >= MIN_REASONING_LENGTH) {
      blocks.push({
        blockType: 'thinking',
        content,
        confidence: 'high',
        associatedEventIndices: [],
        sourceOffset: m.index,
      });
    }
  }

  // 2. Reasoning-prefix lines — medium signal
  const lineBlocks = extractReasoningLines(text, 'medium');
  blocks.push(...lineBlocks);

  return blocks;
}

/**
 * Aider parser.
 *
 * Aider emits conversational reasoning inline with its output.
 * Extracts reasoning-prefix lines and multi-sentence paragraphs.
 */
function parseAider(text: string): ReasoningBlock[] {
  return extractReasoningLines(text, 'medium');
}

/**
 * Generic fallback parser.
 *
 * Heuristic: extract prose lines that look like reasoning but not code.
 * Lower confidence since we have no agent-specific markers.
 */
function parseGeneric(text: string): ReasoningBlock[] {
  const blocks: ReasoningBlock[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let current: string[] = [];
  let currentStart = -1;

  for (const line of lines) {
    const stripped = line.trim();
    if (
      stripped.length > MIN_REASONING_LENGTH &&
      stripped.length < MAX_REASONING_LENGTH &&
      !isCodeLine(stripped) &&
      looksLikeProse(stripped)
    ) {
      if (current.length === 0) currentStart = offset;
      current.push(stripped);
    } else if (current.length > 0) {
      const content = current.join(' ');
      if (content.length >= MIN_REASONING_LENGTH) {
        blocks.push({
          blockType: 'generic',
          content,
          confidence: 'low',
          associatedEventIndices: [],
          sourceOffset: currentStart,
        });
      }
      current = [];
      currentStart = -1;
    }
    offset += line.length + 1;
  }

  if (current.length > 0) {
    const content = current.join(' ');
    if (content.length >= MIN_REASONING_LENGTH) {
      blocks.push({
        blockType: 'generic',
        content,
        confidence: 'low',
        associatedEventIndices: [],
        sourceOffset: currentStart,
      });
    }
  }

  return blocks;
}

/**
 * Extract reasoning-prefix lines from text, merging consecutive lines
 * into coherent blocks.
 */
function extractReasoningLines(text: string, confidence: 'high' | 'medium' | 'low'): ReasoningBlock[] {
  const blocks: ReasoningBlock[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let current: string[] = [];
  let currentStart = -1;
  let currentType: ReasoningBlockType = 'generic';

  for (const line of lines) {
    const stripped = line.trim();

    if (isReasoningPrefixLine(stripped)) {
      if (current.length === 0) {
        currentStart = offset;
        currentType = classifyLine(stripped);
      }
      current.push(stripped);
    } else if (current.length > 0 && stripped.length > 0 && !isCodeLine(stripped) && looksLikeProse(stripped)) {
      // Continuation of a reasoning paragraph
      current.push(stripped);
    } else if (current.length > 0) {
      const content = current.join(' ');
      if (content.length >= MIN_REASONING_LENGTH) {
        blocks.push({
          blockType: currentType,
          content,
          confidence,
          associatedEventIndices: [],
          sourceOffset: currentStart,
        });
      }
      current = [];
      currentStart = -1;
    }

    offset += line.length + 1;
  }

  if (current.length > 0) {
    const content = current.join(' ');
    if (content.length >= MIN_REASONING_LENGTH) {
      blocks.push({
        blockType: currentType,
        content,
        confidence,
        associatedEventIndices: [],
        sourceOffset: currentStart,
      });
    }
  }

  return blocks;
}

/**
 * Assign associatedEventIndices to each block.
 *
 * Strategy: for each block, find the file/command events that occur between
 * this block's source stdout event and the next block's source stdout event.
 * This captures the "agent reasons, then acts" pattern.
 */
function associateBlocksWithEvents(
  blocks: ReasoningBlock[],
  events: SessionEvent[],
  chunkBoundaries: ChunkBoundary[],
): void {
  // Resolve each block to its source stdout event index
  const resolved = blocks
    .map(block => {
      const chunk = block.sourceOffset !== undefined
        ? chunkBoundaries.find(b => block.sourceOffset! >= b.start && block.sourceOffset! < b.end)
        : undefined;
      return { block, sourceIdx: chunk?.eventIndex ?? -1 };
    })
    .filter(r => r.sourceIdx >= 0)
    .sort((a, b) => a.sourceIdx - b.sourceIdx);

  const FILE_TYPES = new Set(['file_created', 'file_modified', 'file_deleted']);

  for (let bi = 0; bi < resolved.length; bi++) {
    const { block, sourceIdx } = resolved[bi];
    // Window ends at the next block's stdout event (or end of session)
    const windowEnd = bi + 1 < resolved.length
      ? resolved[bi + 1].sourceIdx
      : events.length;

    const indices: number[] = [];
    for (let ei = sourceIdx + 1; ei < windowEnd; ei++) {
      if (FILE_TYPES.has(events[ei].type)) {
        indices.push(ei);
      }
    }
    block.associatedEventIndices = indices;
  }
}

function detectAgentType(hint?: string): AgentType {
  if (!hint) return 'generic';
  const h = hint.toLowerCase();
  if (h.includes('claude')) return 'claude-code';
  if (h.includes('aider')) return 'aider';
  return 'generic';
}

function isReasoningPrefixLine(line: string): boolean {
  if (line.length < MIN_REASONING_LENGTH) return false;
  return REASONING_PREFIXES.some(re => re.test(line));
}

function isCodeLine(line: string): boolean {
  return CODE_LINE_RE.test(line);
}

function looksLikeProse(line: string): boolean {
  const codeSymbols = (line.match(/[{}\[\]();=<>|`\\]/g) ?? []).length;
  const wordChars = (line.match(/[a-zA-Z]/g) ?? []).length;
  // More letters than code symbols and has at least one real word
  return codeSymbols < 4 && wordChars > 10 && /[a-zA-Z]{3,}/.test(line);
}

function classifyLine(line: string): ReasoningBlockType {
  const l = line.toLowerCase();
  if (/\b(?:plan|approach|step|first|then|next|after|finally|begin|start)\b/.test(l)) return 'plan';
  if (/\b(?:see|notice|observe|look|find|found|contain|show|has|have)\b/.test(l)) return 'observation';
  if (/\b(?:because|reason|why|need|must|should|require|in order|so that)\b/.test(l)) return 'rationale';
  return 'generic';
}
