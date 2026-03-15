import chalk from 'chalk';

export async function agentsCommand(): Promise<void> {
  const { listAgents } = await import('../agents/registry.js');
  const agents = listAgents();

  console.log('');
  console.log(chalk.bold.white('  Agent Wrappers'));
  console.log(chalk.dim('  ' + '\u2500'.repeat(40)));
  console.log('');

  if (agents.length === 0) {
    console.log(chalk.dim('  No agent wrappers registered.'));
    console.log('');
    return;
  }

  for (const agent of agents) {
    console.log(`  ${chalk.bold.white(agent.name.padEnd(14))} ${chalk.dim(agent.displayName)}`);
    console.log(`  ${' '.repeat(14)} ${chalk.dim(agent.description)}`);
    console.log(`  ${' '.repeat(14)} ${chalk.dim('Binary:')} ${chalk.white(agent.binary)}  ${chalk.dim('Env:')} ${chalk.white(agent.requiredEnvVars.join(', ') || 'none')}`);
    console.log('');
  }

  console.log(chalk.dim('  Usage: ithilien run --agent <name> "your prompt here"'));
  console.log('');
  console.log(chalk.bold.white('  What wrappers do'));
  console.log(chalk.dim('  ' + '\u2500'.repeat(40)));
  console.log('');
  console.log(chalk.dim('  A wrapper constructs a shell command from your prompt.'));
  console.log(chalk.dim('  It does NOT parse agent output or control agent behavior.'));
  console.log(chalk.dim('  The constructed command runs through the same policy'));
  console.log(chalk.dim('  evaluation and sandbox enforcement as any manual command.'));
  console.log('');
}
