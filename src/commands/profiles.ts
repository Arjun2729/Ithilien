import chalk from 'chalk';
import { listProfiles } from '../config/profiles.js';

export async function profilesCommand(): Promise<void> {
  const profiles = listProfiles();

  console.log('');
  console.log(chalk.bold.white('  Guardrail Profiles'));
  console.log(chalk.dim('  ' + '\u2500'.repeat(40)));
  console.log('');

  for (const p of profiles) {
    console.log(`  ${chalk.bold.white(p.name.padEnd(14))} ${chalk.dim(p.description)}`);
    console.log(`  ${' '.repeat(14)} ${chalk.dim('Network:')} ${networkLabel(p.network.mode)}`);
    console.log(`  ${' '.repeat(14)} ${chalk.dim('CPU:')} ${p.resources.cpuLimit}  ${chalk.dim('Mem:')} ${p.resources.memoryLimit}  ${chalk.dim('Timeout:')} ${formatDuration(p.resources.maxDuration)}`);
    console.log(`  ${' '.repeat(14)} ${chalk.dim('Git push:')} ${p.git.allowPush ? chalk.green('yes') : chalk.red('no')}  ${chalk.dim('Force:')} ${p.git.allowForce ? chalk.green('yes') : chalk.red('no')}`);
    console.log('');
  }

  console.log(chalk.dim('  Use --profile <name> with `ithilien run` to select a profile.'));
  console.log(chalk.dim('  Custom profiles: .ithilien/profiles/<name>.json'));
  console.log('');
}

function networkLabel(mode: string): string {
  switch (mode) {
    case 'none': return chalk.red('none (fully isolated)');
    case 'allowlist': return chalk.yellow('allowlist (restricted)');
    case 'full': return chalk.green('full (unrestricted)');
    default: return mode;
  }
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
