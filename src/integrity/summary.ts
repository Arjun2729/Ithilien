import type { VerificationReport } from '../types.js';

/**
 * Generate a Markdown summary from a VerificationReport.
 *
 * Pure function, no side effects. Output is suitable for
 * $GITHUB_STEP_SUMMARY or any Markdown renderer.
 *
 * No ANSI codes, no emoji — cross-platform safe.
 */
export function generateSummaryMarkdown(
  report: VerificationReport,
  bundle?: { formatVersion: number; bundledAt: string; bundledBy: string },
): string {
  const lines: string[] = [];

  lines.push('## Ithilien Verification Report');
  lines.push('');

  // Main summary table
  const integrityStatus = report.chain.intact ? 'Pass' : 'FAIL';
  let signatureStatus = 'Not signed';
  if (report.signature.present) {
    signatureStatus = report.signature.valid ? 'Ed25519 verified' : 'INVALID';
  }

  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Session | \`${report.sessionId}\` |`);
  lines.push(`| Status | ${report.sessionStatus} |`);
  lines.push(`| Integrity | ${integrityStatus} |`);
  lines.push(`| Signature | ${signatureStatus} |`);
  lines.push(`| Root Hash | \`${report.rootHash}\` |`);
  lines.push(`| Events | ${report.events.total} |`);
  lines.push(`| Duration | ${report.timing.firstEvent} \u2192 ${report.timing.lastEvent} |`);

  if (bundle) {
    lines.push(`| Bundle Format | v${bundle.formatVersion} |`);
    lines.push(`| Bundled At | ${bundle.bundledAt} |`);
    lines.push(`| Bundled By | ${bundle.bundledBy} |`);
  }

  if (report.chain.brokenAt !== undefined) {
    lines.push('');
    lines.push(`**Chain broken at event ${report.chain.brokenAt}.**`);
  }

  if (report.sessionStatus === 'denied') {
    lines.push('');
    lines.push('**Session was denied by policy enforcement.**');
  }

  // Event breakdown
  const categories = Object.entries(report.events.byCategory).sort();
  if (categories.length > 0) {
    lines.push('');
    lines.push('### Event Breakdown');
    lines.push('');
    lines.push('| Category | Count |');
    lines.push('|----------|-------|');
    for (const [cat, count] of categories) {
      lines.push(`| ${cat} | ${count} |`);
    }
  }

  // Policy context
  if (report.policy) {
    lines.push('');
    lines.push('### Policy');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push(`| Sources | ${report.policy.sources.join(', ')} |`);
    lines.push(`| Hash | \`${report.policy.policyHash}\` |`);
    lines.push(`| Engine | ${report.policy.engineVersion} |`);
    if (report.policy.policyPath) {
      lines.push(`| Path | ${report.policy.policyPath} |`);
    }
  }

  // Policy decisions (extracted from the details or report)
  // The report itself doesn't contain individual decisions, but we can
  // check for policy event counts to indicate policy was evaluated
  if (report.events.byType.policy_decision) {
    const count = report.events.byType.policy_decision;
    lines.push('');
    lines.push(`*${count} policy decision${count !== 1 ? 's' : ''} recorded in session.*`);
  }

  // Footer
  lines.push('');
  lines.push(`> Verified by Ithilien${report.environment.ithilienVersion !== 'unknown' ? ` v${report.environment.ithilienVersion}` : ''}`);
  lines.push('');

  return lines.join('\n');
}
