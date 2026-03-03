import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadSession, setSessionsDir } from '../audit/session.js';
import { loadConfig } from '../config/loader.js';
import { cp, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { diffCommand } from './diff.js';

export interface ApplyOptions {
  commit: boolean;
}

export async function applyCommand(id: string, opts: ApplyOptions): Promise<void> {
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

  // Collect file changes from events
  const created = session.events.filter((e) => e.type === 'file_created');
  const modified = session.events.filter((e) => e.type === 'file_modified');
  const deleted = session.events.filter((e) => e.type === 'file_deleted');

  const totalChanges = created.length + modified.length + deleted.length;
  if (totalChanges === 0) {
    console.log('');
    console.log(chalk.dim('  No file changes to apply for this session.'));
    console.log('');
    return;
  }

  // Show diff first
  console.log(chalk.bold.white('\n  Changes to apply:\n'));
  await diffCommand(id);

  // Summary
  console.log(chalk.bold.white('  Summary:'));
  if (created.length > 0) console.log(chalk.green(`    +${created.length} file(s) created`));
  if (modified.length > 0) console.log(chalk.yellow(`    ~${modified.length} file(s) modified`));
  if (deleted.length > 0) console.log(chalk.red(`    -${deleted.length} file(s) deleted`));
  console.log('');

  // Confirm
  const { proceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Apply these changes to your workspace?',
      default: false,
    },
  ]);

  if (!proceed) {
    console.log(chalk.dim('  Cancelled.'));
    return;
  }

  const projectPath = session.projectPath;
  const { ensureSessionsDir } = await import('../audit/session.js');
  const sessionsBaseDir = await ensureSessionsDir();
  const sessionFilesDir = join(sessionsBaseDir, id, 'files');

  // Apply created and modified files
  let applied = 0;
  for (const event of [...created, ...modified]) {
    if (event.type !== 'file_created' && event.type !== 'file_modified') continue;
    const srcFile = join(sessionFilesDir, event.path);
    const destFile = join(projectPath, event.path);

    if (existsSync(srcFile)) {
      await mkdir(dirname(destFile), { recursive: true });
      await cp(srcFile, destFile);
      applied++;
      console.log(chalk.green(`  \u2713 ${event.path}`));
    } else {
      console.log(chalk.yellow(`  \u26A0 ${event.path} (source not found in session storage)`));
    }
  }

  // Handle deleted files
  for (const event of deleted) {
    if (event.type !== 'file_deleted') continue;
    const filePath = join(projectPath, event.path);

    if (existsSync(filePath)) {
      const { confirmDelete } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmDelete',
          message: `Delete ${event.path}?`,
          default: false,
        },
      ]);

      if (confirmDelete) {
        await rm(filePath);
        applied++;
        console.log(chalk.red(`  \u2713 Deleted ${event.path}`));
      } else {
        console.log(chalk.dim(`  \u2014 Skipped ${event.path}`));
      }
    }
  }

  console.log('');
  console.log(chalk.green(`  Applied ${applied} change(s).`));

  // Optional git commit
  if (opts.commit) {
    try {
      const commitMsg = `ithilien: apply session ${id}\n\nAgent command: ${session.command}\nProfile: ${session.profile}`;
      execSync('git add -A', { cwd: projectPath, stdio: 'pipe' });
      execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: projectPath, stdio: 'pipe' });
      console.log(chalk.green('  \u2713 Git commit created.'));
    } catch (err) {
      console.log(chalk.yellow('  \u26A0 Git commit failed: ' + (err as Error).message));
    }
  }

  console.log('');
}
