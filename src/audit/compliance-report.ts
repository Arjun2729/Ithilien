/**
 * Compliance report generator.
 *
 * Produces a ComplianceReport from a session — the artifact an auditor reviews
 * to understand what an AI agent did, why it did it, what guardrails were active,
 * and whether the record was tampered with.
 *
 * This is a pure function with no side effects.
 */

import type { Session, SessionEvent, VerificationResult } from '../types.js';
import type {
  ComplianceReport,
  ComplianceReportEntry,
  ComplianceMetadata,
  EuAiActRiskLevel,
} from './schema.js';
import { parseReasoning } from './reasoning-parser.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

function getVersion(): string {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  for (const rel of ['../../package.json', '../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, rel), 'utf-8'));
      if (pkg.name === 'ithilien') return pkg.version as string;
    } catch { /* try next */ }
  }
  return 'unknown';
}

/**
 * Auditable event types — stdout/stderr are excluded because they are the
 * raw source material for reasoning extraction, not auditable actions.
 */
const AUDITABLE_TYPES = new Set<SessionEvent['type']>([
  'file_created',
  'file_modified',
  'file_deleted',
  'command_start',
  'guardrail_triggered',
  'policy_decision',
  'network_request',
  'package_installed',
]);

/**
 * Generate a compliance report for a session.
 *
 * @param session            The session to report on
 * @param verificationResult Optional pre-computed verification result. When omitted,
 *                           integrityValid is set to false and signatureValid is omitted.
 *                           Pass the result from verifySession() for accurate integrity status.
 */
export function generateComplianceReport(
  session: Session,
  verificationResult?: VerificationResult,
): ComplianceReport {
  const agentHint = session.agent ?? session.command;
  const reasoning = parseReasoning(session.events, agentHint);

  // Index event hashes from the manifest for O(1) lookup
  const eventHashByIndex = new Map<number, { eventHash: string; chainHash: string }>();
  if (session.manifest?.eventHashes) {
    for (const eh of session.manifest.eventHashes) {
      eventHashByIndex.set(eh.eventIndex, {
        eventHash: eh.eventHash,
        chainHash: eh.chainHash,
      });
    }
  }

  // Map: session event index → policy decision fields
  // A policy_decision event immediately precedes the command it governs.
  const policyForCommand = buildPolicyDecisionMap(session.events);

  // Map: session event index → reasoning blocks associated with it
  const reasoningForEvent = new Map<number, typeof reasoning.blocks>();
  for (const block of reasoning.blocks) {
    for (const idx of block.associatedEventIndices) {
      const existing = reasoningForEvent.get(idx) ?? [];
      existing.push(block);
      reasoningForEvent.set(idx, existing);
    }
  }

  // Build per-event audit entries
  const context = session.prompt ?? session.command;
  const entries: ComplianceReportEntry[] = [];

  for (let i = 0; i < session.events.length; i++) {
    const ev = session.events[i];
    if (!AUDITABLE_TYPES.has(ev.type)) continue;

    const hashes = eventHashByIndex.get(i);
    entries.push({
      eventIndex: i,
      eventType: ev.type,
      timestamp: ev.timestamp,
      what: describeEvent(ev),
      why: reasoningForEvent.get(i) ?? [],
      context,
      eventHash: hashes?.eventHash ?? '',
      chainHash: hashes?.chainHash ?? '',
      ...(ev.type === 'command_start' && policyForCommand.has(i)
        ? { policyDecision: policyForCommand.get(i) }
        : {}),
    });
  }

  // Compute summary stats
  const fileChangeCount = session.events.filter(
    e => e.type === 'file_created' || e.type === 'file_modified' || e.type === 'file_deleted',
  ).length;

  const fileChangeIndices = session.events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.type === 'file_created' || e.type === 'file_modified' || e.type === 'file_deleted')
    .map(({ i }) => i);

  const coveredCount = fileChangeIndices.filter(
    i => (reasoningForEvent.get(i)?.length ?? 0) > 0,
  ).length;

  const reasoningCoveragePercent = fileChangeIndices.length > 0
    ? Math.round((coveredCount / fileChangeIndices.length) * 100)
    : 0;

  const integrityValid = verificationResult?.valid ?? false;
  const version = getVersion();

  return {
    schemaVersion: 1,
    sessionId: session.id,
    generatedAt: new Date().toISOString(),
    agentType: session.agent ?? 'unknown',
    prompt: context,
    rootHash: session.manifest?.rootHash ?? '',
    integrityValid,
    ...(verificationResult?.signatureValid !== undefined
      ? { signatureValid: verificationResult.signatureValid }
      : {}),
    compliance: buildComplianceMetadata(session, version),
    entries,
    reasoning,
    summary: {
      totalEvents: session.events.length,
      filesChanged: fileChangeCount,
      commandsExecuted: session.events.filter(e => e.type === 'command_start').length,
      policiesTriggered: session.events.filter(e => e.type === 'policy_decision').length,
      guardrailsTriggered: session.events.filter(e => e.type === 'guardrail_triggered').length,
      reasoningBlocksExtracted: reasoning.blocks.length,
      reasoningCoveragePercent,
    },
  };
}

/**
 * Describe a session event in human-readable form for the audit log.
 */
function describeEvent(ev: SessionEvent): string {
  switch (ev.type) {
    case 'file_created':   return `Created ${ev.path}`;
    case 'file_modified':  return `Modified ${ev.path}`;
    case 'file_deleted':   return `Deleted ${ev.path}`;
    case 'command_start':  return `Executed: ${ev.command}`;
    case 'guardrail_triggered':
      return `Guardrail "${ev.rule}" triggered → ${ev.action}: ${ev.detail}`;
    case 'policy_decision':
      return `Policy decision: ${ev.action} "${ev.command}" (${ev.risk} risk, ${ev.source})`;
    case 'network_request':
      return `Network ${ev.allowed ? 'allowed' : 'blocked'}: ${ev.destination}`;
    case 'package_installed':
      return `Package installed: ${ev.manager} ${ev.name}@${ev.version}`;
    default:
      return (ev as { type: string }).type;
  }
}

/**
 * Build a map from command_start event index → the policy_decision that
 * immediately preceded it in the event stream.
 */
function buildPolicyDecisionMap(
  events: SessionEvent[],
): Map<number, ComplianceReportEntry['policyDecision']> {
  const map = new Map<number, ComplianceReportEntry['policyDecision']>();
  let pending: ComplianceReportEntry['policyDecision'] | undefined;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'policy_decision') {
      pending = {
        action: ev.action,
        risk: ev.risk,
        rule: ev.rule,
        source: ev.source,
        reason: ev.reason,
      };
    } else if (ev.type === 'command_start' && pending) {
      map.set(i, pending);
      pending = undefined;
    }
  }

  return map;
}

/**
 * Build compliance metadata, inferring EU AI Act risk level from session content.
 *
 * The heuristic is intentionally conservative: if the session triggered guardrail
 * denials or evaluated any high/critical risk commands, we classify as high-risk.
 * Users operating systems they know are high-risk should hardcode this.
 */
function buildComplianceMetadata(session: Session, version: string): ComplianceMetadata {
  const hasDenials = session.events.some(
    e => e.type === 'guardrail_triggered' && e.action === 'deny',
  );
  const hasHighRisk = session.events.some(
    e => e.type === 'policy_decision' && (e.risk === 'high' || e.risk === 'critical'),
  );

  let euAiActRiskLevel: EuAiActRiskLevel;
  let retentionDays: number;

  if (hasDenials || hasHighRisk) {
    // Conservative: treat as high-risk requiring 10-year retention
    euAiActRiskLevel = 'high';
    retentionDays = 3650;
  } else {
    euAiActRiskLevel = 'limited';
    retentionDays = 365;
  }

  return {
    euAiActRiskLevel,
    retentionDays,
    // All four NIST AI RMF functions are evidenced:
    // GOVERN: policy provenance and guardrail configuration recorded
    // MAP: session context, prompt, and agent type captured
    // MEASURE: event counts, coverage metrics, timing
    // MANAGE: enforcement decisions (allow/deny/ask) recorded with rationale
    nistAiRmfFunctions: ['GOVERN', 'MAP', 'MEASURE', 'MANAGE'],
    frameworks: [
      'EU AI Act Article 12',
      'NIST AI RMF 1.0',
      'OWASP LLM Top 10',
    ],
    generatedAt: new Date().toISOString(),
    generatedBy: `ithilien@${version}`,
  };
}
