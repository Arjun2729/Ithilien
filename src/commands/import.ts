import chalk from 'chalk';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { importBundle } from '../bundle/importer.js';
import { setSessionsDir } from '../audit/session.js';
import { loadConfig } from '../config/loader.js';
import { EXIT_INVALID_INPUT, EXIT_VERIFICATION_FAILED } from '../exit-codes.js';

export async function importCommand(bundleFile: string): Promise<void> {
  const config = await loadConfig();
  setSessionsDir(config.sessionsDir);

  const bundlePath = resolve(bundleFile);

  if (!existsSync(bundlePath)) {
    console.error(chalk.red(`  File not found: ${bundlePath}`));
    process.exit(EXIT_INVALID_INPUT);
  }

  console.log('');

  try {
    const { session, details } = await importBundle(bundlePath);

    console.log(
      chalk.green('  \u2713') +
        chalk.white(` Bundle verified and imported as session ${session.id}`),
    );
    console.log(chalk.dim(`  ${details}`));
  } catch (err) {
    const msg = (err as Error).message;
    const isIntegrityError = msg.includes('integrity check failed');
    console.error(
      chalk.red('  \u2717') +
        chalk.white(` Import failed: ${msg}`),
    );
    process.exit(isIntegrityError ? EXIT_VERIFICATION_FAILED : EXIT_INVALID_INPUT);
  }

  console.log('');
}
