import chalk from 'chalk';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { loadSession, setSessionsDir } from '../audit/session.js';
import { exportBundle } from '../bundle/exporter.js';
import { loadConfig } from '../config/loader.js';

export async function exportCommand(
  id: string,
  opts: { output?: string },
): Promise<void> {
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

  if (!session.manifest) {
    console.error(chalk.red('  Session has no integrity manifest.'));
    console.error(
      chalk.dim(
        '  Only sessions created with integrity tracking can be exported.',
      ),
    );
    process.exit(1);
  }

  const outputPath = resolve(opts.output || '.');

  console.log('');
  const bundlePath = await exportBundle(session, outputPath);

  const info = await stat(bundlePath);
  const sizeMB = (info.size / (1024 * 1024)).toFixed(1);

  // Count diffs
  let diffCount = 0;
  for (const event of session.events) {
    if (
      (event.type === 'file_modified' ||
        event.type === 'file_created' ||
        event.type === 'file_deleted') &&
      event.diff
    ) {
      diffCount++;
    }
  }

  console.log(
    chalk.green('  ✓') +
      chalk.white(` Exported to ${bundlePath} (${sizeMB} MB)`),
  );
  console.log(
    chalk.dim(
      `  Contains: ${session.events.length} events, ${diffCount} file diffs${session.manifest.signature ? ', signed manifest' : ''}`,
    ),
  );
  console.log('');
}
