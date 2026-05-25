import chalk from 'chalk';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { detectGvisor, GVISOR_INSTALL_URL } from '../sandbox/runtime.js';

export async function initCommand(): Promise<void> {
  const projectPath = resolve(process.cwd());
  const ithilienDir = join(projectPath, '.ithilien');

  if (existsSync(ithilienDir)) {
    console.log(chalk.yellow('  .ithilien/ already exists in this project.'));
    return;
  }

  // Detect available runtimes before writing config
  const gvisorAvailable = detectGvisor();
  const detectedRuntime = gvisorAvailable ? 'gvisor-runsc' : 'docker-runc';

  // Create directory structure
  await mkdir(join(ithilienDir, 'profiles'), { recursive: true });
  await mkdir(join(ithilienDir, 'sessions'), { recursive: true });

  // Write default config with detected runtime
  const config = {
    defaultProfile: 'default',
    runtime: detectedRuntime,
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

  if (gvisorAvailable) {
    console.log(chalk.green('  \u2713') + chalk.white(' gVisor detected — sandboxed runs will use runsc (syscall interception)'));
  } else {
    console.log(chalk.yellow('  \u26a0  gVisor not found — sandboxed runs will use Docker (runc, shared host kernel)'));
    console.log('');
    console.log(chalk.dim('  Docker provides process isolation but shares the host kernel.'));
    console.log(chalk.dim('  Install gVisor for stronger isolation (recommended for compliance):'));
    console.log(chalk.white('    ' + GVISOR_INSTALL_URL));
  }

  console.log('');
  console.log(chalk.dim('  Runtime set in .ithilien/config.json: ') + chalk.white(detectedRuntime));
  console.log(chalk.dim('  Override per-run with: ') + chalk.white('ithilien run --runtime <gvisor-runsc|docker-runc>'));
  console.log('');
}
