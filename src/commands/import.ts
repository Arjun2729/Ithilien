import chalk from 'chalk';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { importBundle } from '../bundle/importer.js';
import { setSessionsDir } from '../audit/session.js';
import { loadConfig } from '../config/loader.js';

export async function importCommand(bundleFile: string): Promise<void> {
  const config = await loadConfig();
  setSessionsDir(config.sessionsDir);

  const bundlePath = resolve(bundleFile);

  if (!existsSync(bundlePath)) {
    console.error(chalk.red(`  File not found: ${bundlePath}`));
    process.exit(1);
  }

  console.log('');

  try {
    const { session, details } = await importBundle(bundlePath);

    console.log(
      chalk.green('  ✓') +
        chalk.white(` Bundle verified and imported as session ${session.id}`),
    );
    console.log(chalk.dim(`  ${details}`));
  } catch (err) {
    console.error(
      chalk.red('  ✗') +
        chalk.white(` Import failed: ${(err as Error).message}`),
    );
    process.exit(1);
  }

  console.log('');
}
