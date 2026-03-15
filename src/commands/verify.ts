import chalk from 'chalk';
import { loadSession, setSessionsDir } from '../audit/session.js';
import { verifySession } from '../integrity/verifier.js';
import { generateVerificationReport } from '../integrity/report.js';
import { generateSummaryMarkdown } from '../integrity/summary.js';
import { categorizeEvent } from '../types.js';
import { loadConfig } from '../config/loader.js';
import { EXIT_SUCCESS, EXIT_VERIFICATION_FAILED, EXIT_INVALID_INPUT } from '../exit-codes.js';
import type { SessionEvent } from '../types.js';

export async function verifyCommand(id: string, options?: { format?: string }): Promise<void> {
  const config = await loadConfig();
  setSessionsDir(config.sessionsDir);

  let session;
  try {
    session = await loadSession(id);
  } catch {
    console.error(chalk.red(`  Session "${id}" not found.`));
    console.error(chalk.dim('  Run `ithilien log` to see available sessions.'));
    process.exit(EXIT_INVALID_INPUT);
  }

  const result = verifySession(session);

  // JSON output mode
  if (options?.format === 'json') {
    const report = generateVerificationReport(session, result);
    console.log(JSON.stringify(report, null, 2));
    process.exit(result.valid ? EXIT_SUCCESS : EXIT_VERIFICATION_FAILED);
  }

  // Summary output mode (Markdown for $GITHUB_STEP_SUMMARY)
  if (options?.format === 'summary') {
    const report = generateVerificationReport(session, result);
    const markdown = generateSummaryMarkdown(report);
    console.log(markdown);
    process.exit(result.valid ? EXIT_SUCCESS : EXIT_VERIFICATION_FAILED);
  }

  // Terminal output mode (default)
  console.log('');
  if (result.valid) {
    console.log(chalk.green('  \u2713') + chalk.bold.white(` Session ${id}: integrity verified`));
  } else {
    console.log(chalk.red('  \u2717') + chalk.bold.white(` Session ${id}: integrity check FAILED`));
  }

  console.log('');
  console.log(`  ${chalk.dim('Root hash:')}  ${chalk.white(result.rootHash)}`);
  console.log(`  ${chalk.dim('Events:')}     ${chalk.white(String(result.eventCount))}${result.valid ? chalk.dim(' (chain intact)') : ''}`);

  if (result.brokenChainAt !== undefined) {
    console.log(`  ${chalk.dim('Broken at:')} ${chalk.red(`event ${result.brokenChainAt}`)}`);
  }

  // Signature status
  if (result.signatureValid === true) {
    console.log(`  ${chalk.dim('Signed:')}     ${chalk.green('\u2713 Ed25519')}`);
  } else if (result.signatureValid === false) {
    console.log(`  ${chalk.dim('Signed:')}     ${chalk.red('\u2717 INVALID')}`);
  } else {
    console.log(`  ${chalk.dim('Signed:')}     ${chalk.dim('Not signed')}`);
  }

  // Session status
  console.log(`  ${chalk.dim('Status:')}     ${statusColor(session.status)}`);

  // Environment fingerprint
  const manifest = session.manifest;
  if (manifest) {
    const fp = manifest.fingerprint;
    console.log(
      `  ${chalk.dim('Environment:')} ${chalk.white(fp.dockerImageTag)} ${chalk.dim(`(${fp.dockerImageId.slice(0, 19)}...)`)}`,
    );
    console.log(
      `  ${chalk.dim('Profile:')}     ${chalk.white(fp.guardrailProfile)}, network: ${chalk.white(fp.networkMode)}`,
    );
    console.log(
      `  ${chalk.dim('Duration:')}    ${chalk.white(manifest.firstEventAt)} \u2192 ${chalk.white(manifest.lastEventAt)}`,
    );

    // Policy context
    if (manifest.policyContext) {
      const pc = manifest.policyContext;
      console.log(
        `  ${chalk.dim('Policy:')}      ${chalk.white(pc.sources.join(', '))} ${chalk.dim(`(${pc.policyHash.slice(0, 12)}...)`)}`,
      );
    }
  }

  // Event breakdown by category
  if (session.events.length > 0) {
    const categoryCount: Record<string, number> = {};
    for (const event of session.events) {
      const { category } = categorizeEvent(event);
      categoryCount[category] = (categoryCount[category] || 0) + 1;
    }
    const parts = Object.entries(categoryCount)
      .sort()
      .map(([cat, count]) => `${cat} ${count}`);
    console.log('');
    console.log(`  ${chalk.dim('Events:')}  ${chalk.white(parts.join(chalk.dim(' \u00B7 ')))}`);
  }

  // Policy decisions
  const policyDecisions = session.events.filter(
    (e): e is Extract<SessionEvent, { type: 'policy_decision' }> =>
      e.type === 'policy_decision',
  );

  if (policyDecisions.length > 0) {
    console.log('');
    console.log(`  ${chalk.dim('Policy Decisions:')}`);
    for (const pd of policyDecisions) {
      const icon = pd.action === 'deny' ? chalk.red('\u2717') : chalk.green('\u2713');
      const actionStr = pd.action.padEnd(6);
      console.log(
        `    ${icon} ${chalk.white(actionStr)} ${chalk.cyan(truncate(pd.command, 30))}  ${chalk.dim(pd.risk.padEnd(10))} ${chalk.dim(pd.category)}`,
      );
    }
  }

  // Denied status warning
  if (session.status === 'denied') {
    console.log('');
    console.log(chalk.yellow('  \u26A0 Session was denied by policy enforcement'));
  }

  console.log('');

  if (!result.valid) {
    console.log(chalk.red(`  ${result.details}`));
    console.log('');
    process.exit(EXIT_VERIFICATION_FAILED);
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return chalk.green(status);
    case 'running':   return chalk.blue(status);
    case 'failed':    return chalk.red(status);
    case 'timeout':   return chalk.yellow(status);
    case 'killed':    return chalk.red(status);
    case 'denied':    return chalk.red(status);
    default:          return status;
  }
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + '\u2026';
}
