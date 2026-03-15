import type { Session, VerificationResult, VerificationReport } from '../types.js';
import { categorizeEvent } from '../types.js';

/**
 * Generate a machine-readable verification report from a session
 * and its verification result.
 *
 * The report includes chain integrity, signature status, policy metadata,
 * environment info, event breakdown by type/category/severity, and timing.
 *
 * This is a pure function with no side effects.
 */
export function generateVerificationReport(
  session: Session,
  result: VerificationResult,
): VerificationReport {
  const manifest = session.manifest;

  // Count events by type, category, severity
  const byType: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const event of session.events) {
    byType[event.type] = (byType[event.type] || 0) + 1;
    const { category, severity } = categorizeEvent(event);
    byCategory[category] = (byCategory[category] || 0) + 1;
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
  }

  return {
    schemaVersion: 1,
    valid: result.valid,
    sessionId: session.id,
    sessionStatus: session.status,
    rootHash: result.rootHash,
    chain: {
      intact: result.valid && result.brokenChainAt === undefined,
      eventCount: result.eventCount,
      ...(result.brokenChainAt !== undefined ? { brokenAt: result.brokenChainAt } : {}),
    },
    signature: {
      present: !!(manifest?.signature),
      ...(result.signatureValid !== undefined ? { valid: result.signatureValid } : {}),
    },
    ...(manifest?.policyContext ? {
      policy: {
        sources: manifest.policyContext.sources,
        policyHash: manifest.policyContext.policyHash,
        ...(manifest.policyContext.policyPath ? { policyPath: manifest.policyContext.policyPath } : {}),
        engineVersion: manifest.policyContext.engineVersion,
        ...(manifest.policyContext.hashAlgorithm ? { hashAlgorithm: manifest.policyContext.hashAlgorithm } : {}),
      },
    } : {}),
    environment: manifest ? {
      dockerImageTag: manifest.fingerprint.dockerImageTag,
      dockerImageId: manifest.fingerprint.dockerImageId,
      guardrailProfile: manifest.fingerprint.guardrailProfile,
      networkMode: manifest.fingerprint.networkMode,
      ithilienVersion: manifest.fingerprint.ithilienVersion,
    } : {
      dockerImageTag: 'unknown',
      dockerImageId: 'unknown',
      guardrailProfile: 'unknown',
      networkMode: 'unknown',
      ithilienVersion: 'unknown',
    },
    events: {
      total: session.events.length,
      byType,
      byCategory,
      bySeverity,
    },
    timing: manifest ? {
      firstEvent: manifest.firstEventAt,
      lastEvent: manifest.lastEventAt,
    } : {
      firstEvent: session.startedAt,
      lastEvent: session.completedAt || session.startedAt,
    },
    details: result.details,
  };
}
