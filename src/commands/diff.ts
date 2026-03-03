import chalk from 'chalk';
import { loadSession, setSessionsDir } from '../audit/session.js';
import { loadConfig } from '../config/loader.js';
import type { SessionEvent } from '../types.js';

export async function diffCommand(id: string): Promise<void> {
  const config = await loadConfig();
  setSessionsDir(config.sessionsDir);
  let session;
  try {
    session = await loadSession(id);
  } catch {
    console.error(chalk.red(`  Session "${id}" not found.`));
    console.error(chalk.dim('  Run `ithilien log` to see available sessions.'));
    process.exit(1);
  }

  const fileEvents = session.events.filter(
    (e): e is Extract<SessionEvent, { type: 'file_created' | 'file_modified' | 'file_deleted' }> =>
      e.type === 'file_created' || e.type === 'file_modified' || e.type === 'file_deleted'
  );

  if (fileEvents.length === 0) {
    console.log('');
    console.log(chalk.dim('  No file changes recorded for this session.'));
    console.log('');
    return;
  }

  console.log('');
  for (const event of fileEvents) {
    if (event.diff) {
      printColorizedDiff(event.diff);
    } else {
      // No diff stored — show a summary line
      const label =
        event.type === 'file_created' ? chalk.green('new file')
        : event.type === 'file_deleted' ? chalk.red('deleted')
        : chalk.yellow('modified');
      console.log(`${label}  ${event.path}`);
      console.log('');
    }
  }
}

function printColorizedDiff(diff: string): void {
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      console.log(chalk.bold(line));
    } else if (line.startsWith('@@')) {
      console.log(chalk.cyan(line));
    } else if (line.startsWith('+')) {
      console.log(chalk.green(line));
    } else if (line.startsWith('-')) {
      console.log(chalk.red(line));
    } else {
      console.log(line);
    }
  }
  console.log('');
}
