import chalk from 'chalk';
import { loadSession } from '../audit/session.js';
import { verifySession } from '../integrity/verifier.js';
import { generateComplianceReport } from '../audit/compliance-report.js';
import { EXIT_INVALID_INPUT } from '../exit-codes.js';
import type { ComplianceReport, ReasoningBlock } from '../audit/schema.js';
import { writeFileSync } from 'node:fs';

export interface ComplianceReportOptions {
  format: 'terminal' | 'json';
  output?: string;
}

export async function complianceReportCommand(
  id: string,
  opts: ComplianceReportOptions,
): Promise<void> {
  let session;
  try {
    session = await loadSession(id);
  } catch {
    console.error(chalk.red(`  Session not found: ${id}`));
    process.exit(EXIT_INVALID_INPUT);
  }

  // Verify integrity so the report includes accurate integrityValid/signatureValid
  const verificationResult = session.manifest ? verifySession(session) : undefined;

  const report = generateComplianceReport(session, verificationResult);

  if (opts.format === 'json') {
    const json = JSON.stringify(report, null, 2);
    if (opts.output) {
      writeFileSync(opts.output, json, 'utf-8');
      console.log(chalk.green(`  ✓ Compliance report written to ${opts.output}`));
    } else {
      process.stdout.write(json + '\n');
    }
    return;
  }

  // Terminal format
  renderTerminalReport(report);
}

function renderTerminalReport(report: ComplianceReport): void {
  const line = chalk.dim('─'.repeat(60));
  console.log('');
  console.log(chalk.bold.white('  Compliance Report'));
  console.log(chalk.dim('  ' + '─'.repeat(40)));
  console.log('');

  // Header
  console.log(`  ${chalk.dim('Session:')}    ${chalk.white(report.sessionId)}`);
  console.log(`  ${chalk.dim('Generated:')}  ${chalk.white(new Date(report.generatedAt).toLocaleString())}`);
  console.log(`  ${chalk.dim('Agent:')}      ${chalk.white(report.agentType || '—')}`);
  console.log(`  ${chalk.dim('Prompt:')}     ${chalk.cyan(truncate(report.prompt, 80))}`);
  console.log('');

  // Integrity status
  const integrityIcon = report.integrityValid ? chalk.green('✓') : chalk.red('✗');
  const integrityLabel = report.integrityValid ? chalk.green('Intact') : chalk.red('INVALID');
  console.log(`  ${chalk.dim('Integrity:')}  ${integrityIcon} ${integrityLabel}`);
  if (report.rootHash) {
    console.log(`  ${chalk.dim('Root hash:')}  ${chalk.dim(report.rootHash.slice(0, 16) + '…')}`);
  }
  if (report.signatureValid !== undefined) {
    const sigIcon = report.signatureValid ? chalk.green('✓') : chalk.red('✗');
    const sigLabel = report.signatureValid ? chalk.green('Valid') : chalk.red('Invalid');
    console.log(`  ${chalk.dim('Signature:')}  ${sigIcon} ${sigLabel}`);
  }
  console.log('');

  // Compliance metadata
  console.log(chalk.bold.white('  Compliance'));
  console.log(chalk.dim('  ' + '─'.repeat(40)));
  const riskColor = report.compliance.euAiActRiskLevel === 'high'
    ? chalk.red
    : report.compliance.euAiActRiskLevel === 'limited'
    ? chalk.yellow
    : chalk.green;
  console.log(`  ${chalk.dim('EU AI Act:')}  ${riskColor(report.compliance.euAiActRiskLevel)} risk`);
  console.log(`  ${chalk.dim('Retention:')}  ${chalk.white(report.compliance.retentionDays + ' days')}`);
  console.log(`  ${chalk.dim('NIST RMF:')}   ${chalk.white(report.compliance.nistAiRmfFunctions.join(', '))}`);
  console.log('');

  // Summary
  console.log(chalk.bold.white('  Summary'));
  console.log(chalk.dim('  ' + '─'.repeat(40)));
  console.log(`  ${chalk.dim('Total events:')}   ${chalk.white(report.summary.totalEvents)}`);
  console.log(`  ${chalk.dim('Files changed:')}  ${chalk.white(report.summary.filesChanged)}`);
  console.log(`  ${chalk.dim('Commands:')}       ${chalk.white(report.summary.commandsExecuted)}`);
  console.log(`  ${chalk.dim('Policy checks:')}  ${chalk.white(report.summary.policiesTriggered)}`);
  if (report.summary.guardrailsTriggered > 0) {
    console.log(`  ${chalk.dim('Guardrails:')}     ${chalk.yellow(report.summary.guardrailsTriggered)}`);
  }
  console.log('');

  // Reasoning coverage
  console.log(chalk.bold.white('  Reasoning Extraction'));
  console.log(chalk.dim('  ' + '─'.repeat(40)));
  console.log(`  ${chalk.dim('Blocks found:')}   ${chalk.white(report.summary.reasoningBlocksExtracted)}`);
  const coverageColor = report.summary.reasoningCoveragePercent >= 70
    ? chalk.green
    : report.summary.reasoningCoveragePercent >= 30
    ? chalk.yellow
    : chalk.dim;
  console.log(`  ${chalk.dim('Coverage:')}       ${coverageColor(report.summary.reasoningCoveragePercent + '%')} ${chalk.dim('of file changes have associated reasoning')}`);
  if (report.summary.reasoningBlocksExtracted === 0) {
    console.log('');
    console.log(chalk.dim('  No reasoning blocks extracted. The agent may not have emitted'));
    console.log(chalk.dim('  structured reasoning, or no stdout was captured.'));
  }
  console.log('');

  // Audit entries — show file changes with their reasoning
  const fileEntries = report.entries.filter(
    e => e.eventType === 'file_created' || e.eventType === 'file_modified' || e.eventType === 'file_deleted',
  );

  if (fileEntries.length > 0) {
    console.log(chalk.bold.white('  File Changes with Reasoning'));
    console.log(chalk.dim('  ' + '─'.repeat(40)));
    for (const entry of fileEntries) {
      const icon = entry.eventType === 'file_created'
        ? chalk.green('+')
        : entry.eventType === 'file_deleted'
        ? chalk.red('-')
        : chalk.yellow('~');
      console.log(`  ${icon} ${chalk.white(entry.what)}`);
      if (entry.eventHash) {
        console.log(`    ${chalk.dim('hash: ' + entry.eventHash.slice(0, 16) + '…')}`);
      }
      if (entry.why.length > 0) {
        for (const block of entry.why) {
          console.log(`    ${chalk.dim('why:  ')}${formatReasoningBlock(block)}`);
        }
      } else {
        console.log(`    ${chalk.dim('why:  (no reasoning captured)')}`);
      }
    }
    console.log('');
  }

  // Enforcement events
  const enforcementEntries = report.entries.filter(
    e => e.eventType === 'guardrail_triggered' || e.eventType === 'policy_decision',
  );

  if (enforcementEntries.length > 0) {
    console.log(chalk.bold.white('  Enforcement Events'));
    console.log(chalk.dim('  ' + '─'.repeat(40)));
    for (const entry of enforcementEntries) {
      const icon = entry.what.includes('deny') || entry.what.includes('blocked')
        ? chalk.red('✗')
        : chalk.dim('·');
      console.log(`  ${icon} ${chalk.white(truncate(entry.what, 80))}`);
    }
    console.log('');
  }

  console.log(chalk.dim(`  Use --format json for the full machine-readable report.`));
  console.log('');

  void line; // suppress unused warning
}

function formatReasoningBlock(block: ReasoningBlock): string {
  const confidenceColor = block.confidence === 'high'
    ? chalk.green
    : block.confidence === 'medium'
    ? chalk.yellow
    : chalk.dim;
  const badge = confidenceColor(`[${block.blockType}]`);
  return `${badge} ${chalk.white(truncate(block.content, 120))}`;
}

function truncate(s: string, maxLen: number): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen - 1) + '…' : trimmed;
}
