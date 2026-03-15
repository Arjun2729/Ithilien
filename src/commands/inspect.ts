import chalk from 'chalk';
import { resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { extractBundle } from '../bundle/importer.js';
import { generateVerificationReport } from '../integrity/report.js';
import { generateSummaryMarkdown } from '../integrity/summary.js';
import { categorizeEvent } from '../types.js';
import { EXIT_SUCCESS, EXIT_VERIFICATION_FAILED, EXIT_INVALID_INPUT } from '../exit-codes.js';
import type { SessionEvent } from '../types.js';

export async function inspectCommand(
  bundleFile: string,
  options?: { format?: string },
): Promise<void> {
  const bundlePath = resolve(bundleFile);

  if (!existsSync(bundlePath)) {
    console.error(chalk.red(`  File not found: ${bundlePath}`));
    process.exit(EXIT_INVALID_INPUT);
  }

  if (!bundlePath.endsWith('.ithilien-bundle')) {
    console.error(chalk.yellow('  Warning: file does not have .ithilien-bundle extension'));
  }

  let extracted;
  try {
    extracted = extractBundle(bundlePath);
  } catch (err) {
    console.error(chalk.red(`  Invalid bundle: ${(err as Error).message}`));
    process.exit(EXIT_INVALID_INPUT);
  }

  const { session, metadata, result } = extracted;

  // JSON output mode
  if (options?.format === 'json') {
    const report = generateVerificationReport(session, result);
    const output = {
      ...report,
      bundle: {
        formatVersion: metadata.formatVersion,
        bundledAt: metadata.bundledAt,
        bundledBy: metadata.bundledBy,
      },
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(result.valid ? EXIT_SUCCESS : EXIT_VERIFICATION_FAILED);
  }

  // Summary output mode (Markdown for $GITHUB_STEP_SUMMARY)
  if (options?.format === 'summary') {
    const report = generateVerificationReport(session, result);
    const markdown = generateSummaryMarkdown(report, {
      formatVersion: metadata.formatVersion,
      bundledAt: metadata.bundledAt,
      bundledBy: metadata.bundledBy,
    });
    console.log(markdown);
    process.exit(result.valid ? EXIT_SUCCESS : EXIT_VERIFICATION_FAILED);
  }

  // Terminal output mode (default)
  console.log('');
  console.log(chalk.bold.white('  Bundle Inspection'));
  console.log(chalk.dim('  ' + '\u2500'.repeat(35)));
  console.log('');

  // Bundle info
  console.log(`  ${chalk.dim('Bundle:')}      ${chalk.white(basename(bundlePath))}`);
  console.log(`  ${chalk.dim('Format:')}      ${chalk.white('v' + metadata.formatVersion)}`);
  console.log(`  ${chalk.dim('Bundled:')}     ${chalk.white(metadata.bundledAt)}`);
  console.log(`  ${chalk.dim('Bundled by:')}  ${chalk.white(metadata.bundledBy)}`);
  console.log('');

  // Session info
  console.log(`  ${chalk.dim('Session:')}     ${chalk.white(session.id)}`);
  console.log(`  ${chalk.dim('Status:')}      ${statusColor(session.status)}`);
  console.log(`  ${chalk.dim('Command:')}     ${chalk.cyan(truncate(session.command, 60))}`);
  console.log(`  ${chalk.dim('Profile:')}     ${chalk.white(session.profile)}`);

  const manifest = session.manifest;
  if (manifest) {
    console.log(`  ${chalk.dim('Duration:')}    ${chalk.white(manifest.firstEventAt)} \u2192 ${chalk.white(manifest.lastEventAt)}`);
  }
  console.log('');

  // Integrity
  if (result.valid) {
    console.log(`  ${chalk.dim('Integrity:')}   ${chalk.green('\u2713')} ${chalk.white(`verified (${result.eventCount} events, chain intact)`)}`);
  } else {
    console.log(`  ${chalk.dim('Integrity:')}   ${chalk.red('\u2717')} ${chalk.red('FAILED')}`);
    if (result.brokenChainAt !== undefined) {
      console.log(`  ${chalk.dim('Broken at:')}   ${chalk.red('event ' + result.brokenChainAt)}`);
    }
  }

  // Signature
  if (result.signatureValid === true) {
    console.log(`  ${chalk.dim('Signature:')}   ${chalk.green('\u2713 Ed25519')}`);
  } else if (result.signatureValid === false) {
    console.log(`  ${chalk.dim('Signature:')}   ${chalk.red('\u2717 INVALID')}`);
  } else {
    console.log(`  ${chalk.dim('Signature:')}   ${chalk.dim('Not signed')}`);
  }

  // Policy
  if (manifest?.policyContext) {
    const pc = manifest.policyContext;
    console.log(
      `  ${chalk.dim('Policy:')}      ${chalk.white(pc.sources.join(', '))} ${chalk.dim(`(${pc.policyHash.slice(0, 12)}...)`)}`,
    );
  }

  console.log('');

  // Event breakdown by category
  const categoryCount: Record<string, number> = {};
  for (const event of session.events) {
    const { category } = categorizeEvent(event);
    categoryCount[category] = (categoryCount[category] || 0) + 1;
  }

  if (Object.keys(categoryCount).length > 0) {
    console.log(`  ${chalk.dim('Events:')}`);
    for (const [cat, count] of Object.entries(categoryCount).sort()) {
      console.log(`    ${chalk.white(cat.padEnd(14))} ${chalk.white(String(count))}`);
    }
    console.log('');
  }

  // Policy decisions
  const policyDecisions = session.events.filter(
    (e): e is Extract<SessionEvent, { type: 'policy_decision' }> =>
      e.type === 'policy_decision',
  );

  if (policyDecisions.length > 0) {
    console.log(`  ${chalk.dim('Policy Decisions:')}`);
    for (const pd of policyDecisions) {
      const icon = pd.action === 'deny' ? chalk.red('\u2717') : chalk.green('\u2713');
      const actionStr = pd.action.padEnd(6);
      console.log(
        `    ${icon} ${chalk.white(actionStr)} ${chalk.cyan(truncate(pd.command, 30))}  ${chalk.dim(pd.risk.padEnd(10))} ${chalk.dim(pd.category)}`,
      );
    }
    console.log('');
  }

  if (!result.valid) {
    console.log(chalk.red(`  ${result.details}`));
    console.log('');
  }

  process.exit(result.valid ? EXIT_SUCCESS : EXIT_VERIFICATION_FAILED);
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
