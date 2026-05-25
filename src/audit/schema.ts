/**
 * Compliance-aligned audit schema for AI agent sessions.
 *
 * Designed to satisfy:
 * - EU AI Act Article 12 — immutable logs for high-risk AI systems, effective August 2026
 * - NIST AI RMF — tool invocations, decision points, and reasoning traceability
 * - OWASP LLM Top 10 — auditability of tool use and autonomous actions
 *
 * The core model: every auditable session event is presented with four dimensions:
 *   what     — the action that occurred (file change, command, enforcement)
 *   why      — the reasoning that motivated it, extracted from agent stdout
 *   context  — the task/prompt the agent was working on
 *   integrity — cryptographic proof that the record was not tampered with
 */

/** Classification of a reasoning block's content type */
export type ReasoningBlockType =
  | 'thinking'      // Extended thinking block (<thinking>...</thinking>)
  | 'rationale'     // Explicit rationale ("I need to...", "The reason is...")
  | 'plan'          // Planned steps ("First I'll...", "My approach:")
  | 'observation'   // Observed state ("I see that...", "The file contains...")
  | 'generic';      // Heuristic prose match

/**
 * A single unit of agent reasoning extracted from stdout.
 * May be associated with one or more subsequent file or command events.
 */
export interface ReasoningBlock {
  blockType: ReasoningBlockType;
  /** Extracted reasoning text */
  content: string;
  /** Parser confidence in this extraction */
  confidence: 'high' | 'medium' | 'low';
  /**
   * Indices into session.events[] for file/command events this reasoning motivated.
   * Determined by temporal proximity: events that follow this block before the
   * next reasoning block.
   */
  associatedEventIndices: number[];
  /**
   * Character offset in concatenated stdout where this block starts.
   * Used internally for event association; not meaningful to consumers.
   */
  sourceOffset?: number;
}

export type AgentType = 'claude-code' | 'aider' | 'generic';

/**
 * All reasoning blocks extracted from a session's stdout, plus provenance metadata.
 */
export interface ReasoningTrace {
  /** Agent type used for parsing strategy selection */
  agentType: AgentType;
  blocks: ReasoningBlock[];
  /** Total characters of stdout that were parsed */
  parsedChars: number;
  /** Number of stdout events that contributed to the parse */
  stdoutEventCount: number;
}

/**
 * EU AI Act Article 12 risk classification.
 * High-risk systems require immutable logs with 10-year retention.
 */
export type EuAiActRiskLevel = 'minimal' | 'limited' | 'high' | 'unacceptable';

/**
 * Compliance framework metadata attached to every compliance report.
 * Consumers should verify the euAiActRiskLevel against their own
 * system classification — Ithilien infers this heuristically.
 */
export interface ComplianceMetadata {
  /**
   * EU AI Act Article 12 risk classification.
   * Inferred from session characteristics (guardrail denials, high-risk commands).
   * Override this field with your own classification for production use.
   */
  euAiActRiskLevel: EuAiActRiskLevel;
  /**
   * Minimum recommended retention period in days.
   * EU AI Act: 3650 days (10 years) for high-risk; 365 days for limited.
   */
  retentionDays: number;
  /**
   * NIST AI RMF core functions evidenced by this session's audit trail.
   * GOVERN (accountability), MAP (context), MEASURE (traceability), MANAGE (enforcement).
   */
  nistAiRmfFunctions: Array<'GOVERN' | 'MAP' | 'MEASURE' | 'MANAGE'>;
  /** Compliance frameworks this report is intended to support */
  frameworks: string[];
  generatedAt: string;
  generatedBy: string;
}

/**
 * One auditor-facing entry — a single session event with its full provenance:
 * what happened, why it happened, what the agent was trying to accomplish,
 * and cryptographic proof that the record is authentic.
 */
export interface ComplianceReportEntry {
  /** Zero-based index into session.events[] */
  eventIndex: number;
  eventType: string;
  timestamp: string;
  /** Human-readable description of what happened */
  what: string;
  /** Reasoning blocks that preceded and motivated this event */
  why: ReasoningBlock[];
  /** The task or prompt the agent was working on when this event occurred */
  context: string;
  /** SHA-256 hash of this event (from the hash chain) */
  eventHash: string;
  /** Cumulative chain hash at this event — links to the root hash */
  chainHash: string;
  /** Policy decision that applied to this event, if any */
  policyDecision?: {
    action: string;
    risk: string;
    rule: string | null;
    source: string;
    reason: string;
  };
}

/**
 * The artifact an auditor reviews to understand what an AI agent did and why.
 *
 * Maps every auditable event to:
 * - The reasoning that motivated it (parsed from agent stdout)
 * - The guardrails and policy that were active
 * - The integrity hash proving the record was not tampered with
 *
 * The rootHash field is the cryptographic anchor. An auditor can verify
 * rootHash independently using `ithilien verify <id>` or `ithilien inspect <bundle>`.
 */
export interface ComplianceReport {
  schemaVersion: 1;
  sessionId: string;
  generatedAt: string;
  /** Agent type used during the session (from --agent flag or inferred) */
  agentType: string;
  /** Original prompt or command */
  prompt: string;
  /** SHA-256 root hash — the tamper-evidence anchor for this session */
  rootHash: string;
  /** Whether the hash chain was intact at report generation time */
  integrityValid: boolean;
  /** Whether an Ed25519 signature was present and valid */
  signatureValid?: boolean;
  compliance: ComplianceMetadata;
  /**
   * Per-event audit entries. Only auditable event types are included:
   * file changes, commands, guardrail triggers, policy decisions, network requests.
   */
  entries: ComplianceReportEntry[];
  /** Reasoning extracted from agent stdout and associated with events */
  reasoning: ReasoningTrace;
  summary: {
    totalEvents: number;
    filesChanged: number;
    commandsExecuted: number;
    policiesTriggered: number;
    guardrailsTriggered: number;
    reasoningBlocksExtracted: number;
    /**
     * Percentage of file-change events that have at least one associated
     * reasoning block. Low coverage means the agent did not emit
     * parseable reasoning before changes.
     */
    reasoningCoveragePercent: number;
  };
}
