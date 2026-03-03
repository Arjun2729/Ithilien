import chalk from 'chalk';
import boxen from 'boxen';
import type { Session, SessionSummary, SessionEvent } from '../types.js';

/**
 * Format a duration in seconds into a human-readable string.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm.toString().padStart(2, '0')}m`;
}

/**
 * Status color helper.
 */
function statusColor(status: string): string {
  switch (status) {
    case 'completed': return chalk.green(status);
    case 'running':   return chalk.blue(status);
    case 'failed':    return chalk.red(status);
    case 'timeout':   return chalk.yellow(status);
    case 'killed':    return chalk.red(status);
    default:          return status;
  }
}

/**
 * Truncate a string with ellipsis.
 */
function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + '\u2026';
}

/**
 * Render a session summary to the terminal.
 */
export function renderTerminalSummary(session: Session, summary: SessionSummary): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold.white('  Session Summary'));
  lines.push(chalk.dim('  ' + '\u2500'.repeat(40)));
  lines.push('');
  lines.push(`  ${chalk.dim('ID:')}        ${chalk.white(session.id)}`);
  lines.push(`  ${chalk.dim('Status:')}    ${statusColor(session.status)}`);
  lines.push(`  ${chalk.dim('Duration:')}  ${chalk.white(formatDuration(summary.duration))}`);
  lines.push(`  ${chalk.dim('Profile:')}   ${chalk.white(session.profile)}`);
  lines.push(`  ${chalk.dim('Command:')}   ${chalk.cyan(truncate(session.command, 60))}`);
  lines.push('');

  // File changes
  const fileChanges: string[] = [];
  if (summary.filesCreated > 0) fileChanges.push(chalk.green(`+${summary.filesCreated} created`));
  if (summary.filesModified > 0) fileChanges.push(chalk.yellow(`~${summary.filesModified} modified`));
  if (summary.filesDeleted > 0) fileChanges.push(chalk.red(`-${summary.filesDeleted} deleted`));
  if (fileChanges.length > 0) {
    lines.push(`  ${chalk.dim('Files:')}     ${fileChanges.join(chalk.dim(' | '))}`);
  } else {
    lines.push(`  ${chalk.dim('Files:')}     ${chalk.dim('no changes')}`);
  }

  // Lines changed
  if (summary.totalLinesAdded > 0 || summary.totalLinesRemoved > 0) {
    lines.push(
      `  ${chalk.dim('Lines:')}     ${chalk.green('+' + summary.totalLinesAdded)} ${chalk.red('-' + summary.totalLinesRemoved)}`
    );
  }

  if (summary.guardrailsTriggered > 0) {
    lines.push(`  ${chalk.dim('Guardrails:')} ${chalk.yellow(summary.guardrailsTriggered + ' triggered')}`);
  }

  lines.push('');

  // Next steps
  lines.push(chalk.dim('  Review changes:'));
  lines.push(chalk.white(`    ithilien diff ${session.id}`));
  lines.push(chalk.dim('  Apply to workspace:'));
  lines.push(chalk.white(`    ithilien apply ${session.id}`));
  lines.push('');

  return lines.join('\n');
}

/**
 * Render a session log table for the `ithilien log` command.
 */
export function renderSessionTable(sessions: Session[]): string {
  if (sessions.length === 0) {
    return chalk.dim('  No sessions found. Run `ithilien run` to start one.');
  }

  const lines: string[] = [];
  lines.push('');

  // Header
  const header = [
    chalk.dim('SESSION ID'.padEnd(14)),
    chalk.dim('STATUS'.padEnd(12)),
    chalk.dim('DURATION'.padEnd(10)),
    chalk.dim('FILES'.padEnd(12)),
    chalk.dim('COMMAND'),
  ].join('  ');
  lines.push('  ' + header);
  lines.push('  ' + chalk.dim('\u2500'.repeat(80)));

  for (const session of sessions) {
    const summary = session.summary;
    const duration = summary ? formatDuration(summary.duration) : '\u2014';

    let files = '\u2014';
    if (summary) {
      const parts: string[] = [];
      if (summary.filesCreated > 0) parts.push(chalk.green('+' + summary.filesCreated));
      if (summary.filesModified > 0) parts.push(chalk.yellow('~' + summary.filesModified));
      if (summary.filesDeleted > 0) parts.push(chalk.red('-' + summary.filesDeleted));
      files = parts.join(' ') || '\u2014';
    }

    const row = [
      chalk.white(session.id.padEnd(14)),
      statusColor(session.status.padEnd(12)),
      chalk.white(duration.padEnd(10)),
      files.padEnd(12 + 20), // extra padding for ANSI codes
      chalk.dim(truncate(session.command, 40)),
    ].join('  ');

    lines.push('  ' + row);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Render a full audit trail for the `ithilien show` command.
 */
export function renderAuditTrail(session: Session): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold.white(`  Audit Trail: ${session.id}`));
  lines.push(chalk.dim('  ' + '\u2500'.repeat(50)));
  lines.push(`  ${chalk.dim('Started:')}  ${session.startedAt}`);
  if (session.completedAt) {
    lines.push(`  ${chalk.dim('Ended:')}    ${session.completedAt}`);
  }
  lines.push(`  ${chalk.dim('Status:')}   ${statusColor(session.status)}`);
  lines.push(`  ${chalk.dim('Command:')}  ${chalk.cyan(session.command)}`);
  lines.push(`  ${chalk.dim('Profile:')}  ${session.profile}`);
  lines.push(`  ${chalk.dim('Project:')}  ${session.projectPath}`);
  lines.push('');
  lines.push(chalk.bold.white('  Events:'));
  lines.push('');

  for (const event of session.events) {
    lines.push(formatEvent(event));
  }

  lines.push('');
  return lines.join('\n');
}

function formatEvent(event: SessionEvent): string {
  const time = chalk.dim(event.timestamp.slice(11, 19)); // HH:MM:SS

  switch (event.type) {
    case 'command_start':
      return `  ${time}  ${chalk.blue('\u25B6')} ${chalk.white('Command:')} ${chalk.cyan(event.command)}`;
    case 'command_end':
      const icon = event.exitCode === 0 ? chalk.green('\u2713') : chalk.red('\u2717');
      return `  ${time}  ${icon} ${chalk.white('Exit:')} ${event.exitCode}`;
    case 'file_created':
      return `  ${time}  ${chalk.green('+')} ${chalk.white('Created:')} ${event.path} ${chalk.dim(`(${event.size}b)`)}`;
    case 'file_modified':
      return `  ${time}  ${chalk.yellow('~')} ${chalk.white('Modified:')} ${event.path}`;
    case 'file_deleted':
      return `  ${time}  ${chalk.red('-')} ${chalk.white('Deleted:')} ${event.path}`;
    case 'network_request':
      const allowed = event.allowed ? chalk.green('allowed') : chalk.red('blocked');
      return `  ${time}  ${chalk.magenta('\u21C4')} ${chalk.white('Network:')} ${event.destination} [${allowed}]`;
    case 'package_installed':
      return `  ${time}  ${chalk.blue('\u25BC')} ${chalk.white('Installed:')} ${event.name}@${event.version} (${event.manager})`;
    case 'guardrail_triggered':
      return `  ${time}  ${chalk.yellow('\u26A0')} ${chalk.white('Guardrail:')} ${event.rule} \u2014 ${event.detail}`;
    case 'stdout':
      return `  ${time}  ${chalk.dim('  ')} ${event.data.trimEnd()}`;
    case 'stderr':
      return `  ${time}  ${chalk.red('  ')} ${event.data.trimEnd()}`;
    default:
      return `  ${time}  ${chalk.dim('?')} ${JSON.stringify(event)}`;
  }
}

/**
 * Generate an HTML report for a session.
 */
export function renderHTMLReport(session: Session, summary: SessionSummary): string {
  const events = session.events
    .map((e) => {
      const time = e.timestamp.slice(11, 19);
      switch (e.type) {
        case 'command_start':
          return `<div class="event cmd"><span class="time">${time}</span> <span class="icon">\u25B6</span> Command: <code>${escHtml(e.command)}</code></div>`;
        case 'command_end':
          return `<div class="event ${e.exitCode === 0 ? 'ok' : 'err'}"><span class="time">${time}</span> <span class="icon">${e.exitCode === 0 ? '\u2713' : '\u2717'}</span> Exit: ${e.exitCode}</div>`;
        case 'file_created':
          return `<div class="event created"><span class="time">${time}</span> <span class="icon">+</span> Created: ${escHtml(e.path)}</div>`;
        case 'file_modified':
          return `<div class="event modified"><span class="time">${time}</span> <span class="icon">~</span> Modified: ${escHtml(e.path)}</div>`;
        case 'file_deleted':
          return `<div class="event deleted"><span class="time">${time}</span> <span class="icon">-</span> Deleted: ${escHtml(e.path)}</div>`;
        case 'guardrail_triggered':
          return `<div class="event warn"><span class="time">${time}</span> <span class="icon">\u26A0</span> Guardrail: ${escHtml(e.rule)} &mdash; ${escHtml(e.detail)}</div>`;
        case 'stdout':
          return `<div class="event stdout"><span class="time">${time}</span> <pre>${escHtml(e.data)}</pre></div>`;
        case 'stderr':
          return `<div class="event stderr"><span class="time">${time}</span> <pre>${escHtml(e.data)}</pre></div>`;
        default:
          return '';
      }
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ithilien Session: ${session.id}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e4e4e7; padding: 24px; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    .meta { color: #71717a; font-size: 14px; margin-bottom: 24px; }
    .meta span { margin-right: 16px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 32px; }
    .stat { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; }
    .stat .label { font-size: 12px; color: #71717a; text-transform: uppercase; }
    .stat .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
    .stat .value.green { color: #22c55e; }
    .stat .value.yellow { color: #f59e0b; }
    .stat .value.red { color: #ef4444; }
    h2 { font-size: 18px; margin-bottom: 16px; }
    .event { padding: 6px 12px; font-size: 13px; font-family: monospace; border-left: 3px solid #27272a; margin-bottom: 2px; }
    .event .time { color: #52525b; margin-right: 8px; }
    .event.cmd { border-left-color: #3b82f6; }
    .event.ok { border-left-color: #22c55e; }
    .event.err { border-left-color: #ef4444; }
    .event.created { border-left-color: #22c55e; }
    .event.modified { border-left-color: #f59e0b; }
    .event.deleted { border-left-color: #ef4444; }
    .event.warn { border-left-color: #f59e0b; }
    .event.stdout { border-left-color: #27272a; }
    .event.stderr { border-left-color: #ef4444; color: #fca5a5; }
    code { background: #27272a; padding: 2px 6px; border-radius: 4px; }
    pre { display: inline; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Ithilien Session: ${session.id}</h1>
  <div class="meta">
    <span>Status: ${session.status}</span>
    <span>Profile: ${session.profile}</span>
    <span>Started: ${session.startedAt}</span>
    ${session.completedAt ? `<span>Ended: ${session.completedAt}</span>` : ''}
  </div>
  <div class="meta">Command: <code>${escHtml(session.command)}</code></div>

  <div class="summary">
    <div class="stat"><div class="label">Duration</div><div class="value">${formatDuration(summary.duration)}</div></div>
    <div class="stat"><div class="label">Files Created</div><div class="value green">+${summary.filesCreated}</div></div>
    <div class="stat"><div class="label">Files Modified</div><div class="value yellow">~${summary.filesModified}</div></div>
    <div class="stat"><div class="label">Files Deleted</div><div class="value red">-${summary.filesDeleted}</div></div>
    <div class="stat"><div class="label">Lines Added</div><div class="value green">+${summary.totalLinesAdded}</div></div>
    <div class="stat"><div class="label">Lines Removed</div><div class="value red">-${summary.totalLinesRemoved}</div></div>
    <div class="stat"><div class="label">Guardrails</div><div class="value ${summary.guardrailsTriggered > 0 ? 'yellow' : ''}">${summary.guardrailsTriggered}</div></div>
  </div>

  <h2>Event Log</h2>
  ${events}
</body>
</html>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
