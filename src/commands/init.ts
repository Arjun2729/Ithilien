import chalk from 'chalk';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { DEFAULT_PROFILE } from '../config/profiles.js';

export async function initCommand(): Promise<void> {
  const projectPath = resolve(process.cwd());
  const ithilienDir = join(projectPath, '.ithilien');

  if (existsSync(ithilienDir)) {
    console.log(chalk.yellow('  .ithilien/ already exists in this project.'));
    return;
  }

  // Create directory structure
  await mkdir(join(ithilienDir, 'profiles'), { recursive: true });
  await mkdir(join(ithilienDir, 'sessions'), { recursive: true });

  // Write default config (matches IthilienConfig schema)
  const config = {
    defaultProfile: 'default',
    approvalServer: {
      port: 3456,
      timeout: 300,
    },
  };
  await writeFile(
    join(ithilienDir, 'config.json'),
    JSON.stringify(config, null, 2) + '\n',
    'utf-8'
  );

  // Write .gitignore for session data
  await writeFile(
    join(ithilienDir, '.gitignore'),
    'sessions/\n',
    'utf-8'
  );

  console.log('');
  console.log(chalk.green('  \u2713') + chalk.white(' Initialized .ithilien/ in ' + projectPath));
  console.log('');
  console.log(chalk.dim('  Created:'));
  console.log(chalk.white('    .ithilien/config.json') + chalk.dim('    \u2014 project config'));
  console.log(chalk.white('    .ithilien/profiles/') + chalk.dim('      \u2014 custom guardrail profiles'));
  console.log(chalk.white('    .ithilien/sessions/') + chalk.dim('      \u2014 session data (gitignored)'));
  console.log('');
  console.log(chalk.dim('  Add custom profiles to .ithilien/profiles/<name>.json'));
  console.log('');
}
