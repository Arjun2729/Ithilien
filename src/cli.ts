import { Command } from 'commander';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const program = new Command();

program
  .name('ithilien')
  .description('Safe autonomous mode for AI coding agents — sandboxed Docker containers with audit trails')
  .version(pkg.version);

// ===== approve-server command =====
program
  .command('approve-server')
  .description('Start the remote approval server for phone-based tool approvals')
  .option('-p, --port <port>', 'Server port', '3456')
  .option('-t, --timeout <seconds>', 'Seconds before auto-deny on no response', '300')
  .option('--no-tunnel', 'Skip opening a tunnel (local-only mode)')
  .option('--tunnel-url <url>', 'Use a custom tunnel URL (ngrok, cloudflared, etc.) instead of localtunnel')
  .option('--configure', 'Automatically write Claude Code hooks config')
  .action(async (opts) => {
    const chalk = (await import('chalk')).default;
    const { createApprovalServer, generateToken } = await import('./approval/server.js');

    const port = parseInt(opts.port, 10);
    const timeout = parseInt(opts.timeout, 10);
    const authToken = generateToken();

    console.log('');
    console.log(chalk.bold.white('  Ithilien — Remote Approval Server'));
    console.log(chalk.dim('  ─────────────────────────────────'));
    console.log('');

    // Start server
    const srv = createApprovalServer({ port, authToken, timeout });
    try {
      await srv.start();
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'EADDRINUSE') {
        console.log(chalk.red('  ✗') + chalk.white(` Port ${port} is already in use.`));
        console.log('');
        console.log(chalk.dim('    Either stop the other process:'));
        console.log(chalk.white(`      lsof -ti :${port} | xargs kill`));
        console.log('');
        console.log(chalk.dim('    Or use a different port:'));
        console.log(chalk.white(`      ithilien approve-server --port ${port + 1}`));
        console.log('');
        process.exit(1);
      }
      throw err;
    }
    console.log(chalk.green('  ✓') + chalk.white(` Server running on port ${port}`));

    // Open tunnel
    let approvalUrl = `http://localhost:${port}/?token=${authToken}`;
    let tunnelUrl: string | null = null;

    if (opts.tunnelUrl) {
      tunnelUrl = opts.tunnelUrl;
      approvalUrl = `${tunnelUrl}/?token=${authToken}`;
      console.log(chalk.green('  ✓') + chalk.white(` Using custom tunnel: ${tunnelUrl}`));
    } else if (opts.tunnel !== false) {
      try {
        const { openTunnel } = await import('./approval/tunnel.js');
        console.log(chalk.dim('  ◌ Opening tunnel...'));
        const tunnel = await openTunnel(port);
        tunnelUrl = tunnel.url;
        approvalUrl = `${tunnelUrl}/?token=${authToken}`;
        console.log(chalk.green('  ✓') + chalk.white(` Tunnel open: ${tunnelUrl}`));
      } catch (err) {
        console.log(chalk.yellow('  ⚠') + chalk.white(` Tunnel failed: ${(err as Error).message}`));
        console.log(chalk.dim('    Falling back to local-only mode. Use --tunnel-url with ngrok/cloudflared.'));
      }
    }

    console.log('');

    // QR code
    if (tunnelUrl) {
      try {
        const qrcode = require('qrcode-terminal');
        console.log(chalk.bold.white('  Scan with your phone:'));
        console.log('');
        qrcode.generate(approvalUrl, { small: true }, (qr: string) => {
          const lines = qr.split('\n');
          for (const line of lines) {
            console.log('    ' + line);
          }
        });
        console.log('');
      } catch {
        // qrcode-terminal not installed, skip
      }
    }

    console.log(chalk.bold.white('  Phone URL:'));
    console.log(chalk.cyan(`  ${approvalUrl}`));
    console.log('');
    console.log(chalk.dim(`  Auth token: ${authToken}`));
    console.log(chalk.dim(`  Timeout: ${timeout}s per request`));
    console.log('');

    // Hook configuration snippet — include token so the hook authenticates
    const hookUrl = `http://localhost:${port}/api/claude-approval?token=${authToken}`;
    console.log(chalk.bold.white('  Claude Code hook config:'));
    console.log(chalk.dim('  Add this to ~/.claude/settings.json (or .claude/settings.json):'));
    console.log('');

    const hookConfig = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash|Edit|Write',
            hooks: [
              {
                type: 'http',
                url: hookUrl,
                timeout: timeout,
              },
            ],
          },
        ],
      },
    };
    const configJson = JSON.stringify(hookConfig, null, 2);
    for (const line of configJson.split('\n')) {
      console.log(chalk.dim('  ') + chalk.white(line));
    }
    console.log('');

    // Auto-configure if requested
    if (opts.configure) {
      try {
        const { writeHooksConfig } = await import('./approval/configure.js');
        await writeHooksConfig(hookUrl, timeout);
        console.log(chalk.green('  ✓') + chalk.white(' Claude Code hooks configured automatically'));
        console.log('');
      } catch (err) {
        console.log(chalk.yellow('  ⚠') + chalk.white(` Could not auto-configure: ${(err as Error).message}`));
      }
    }

    console.log(chalk.dim('  Press Ctrl+C to stop'));
    console.log('');

    // Graceful shutdown
    const shutdown = async () => {
      console.log('');
      console.log(chalk.dim('  Shutting down...'));
      await srv.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// ===== run =====
program
  .command('run <command>')
  .description('Run an agent command in a sandboxed Docker container')
  .option('--profile <name>', 'Guardrail profile to use', 'default')
  .option('--timeout <seconds>', 'Max session duration in seconds')
  .option('--no-sandbox', 'Skip Docker sandbox (runs directly with warning)')
  .option('--verbose', 'Show detailed output')
  .option('--env <vars...>', 'Environment variables to forward (KEY=VALUE)')
  .action(async (command: string, opts) => {
    const { runCommand } = await import('./commands/run.js');
    await runCommand(command, {
      profile: opts.profile,
      timeout: opts.timeout,
      sandbox: opts.sandbox,
      verbose: opts.verbose ?? false,
      env: opts.env ?? [],
    });
  });

// ===== log =====
program
  .command('log')
  .description('List recent sessions')
  .action(async () => {
    const { logCommand } = await import('./commands/log.js');
    await logCommand();
  });

// ===== show =====
program
  .command('show <id>')
  .description('Show full audit trail for a session')
  .option('--format <type>', 'Output format: terminal or html', 'terminal')
  .action(async (id: string, opts) => {
    const { showCommand } = await import('./commands/show.js');
    await showCommand(id, opts.format);
  });

// ===== diff =====
program
  .command('diff <id>')
  .description('Show unified diff of all file changes in a session')
  .action(async (id: string) => {
    const { diffCommand } = await import('./commands/diff.js');
    await diffCommand(id);
  });

// ===== apply =====
program
  .command('apply <id>')
  .description('Apply changes from a session to your workspace')
  .option('--commit', 'Create a git commit after applying')
  .action(async (id: string, opts) => {
    const { applyCommand } = await import('./commands/apply.js');
    await applyCommand(id, { commit: opts.commit ?? false });
  });

// ===== init =====
program
  .command('init')
  .description('Initialize Ithilien in the current project')
  .action(async () => {
    const { initCommand } = await import('./commands/init.js');
    await initCommand();
  });

// ===== profiles =====
program
  .command('profiles')
  .description('List available guardrail profiles')
  .action(async () => {
    const { profilesCommand } = await import('./commands/profiles.js');
    await profilesCommand();
  });

// ===== verify =====
program
  .command('verify <id>')
  .description('Verify integrity of a session audit trail')
  .action(async (id: string) => {
    const { verifyCommand } = await import('./commands/verify.js');
    await verifyCommand(id);
  });

// ===== export =====
program
  .command('export <id>')
  .description('Export a session as a .ithilien-bundle file')
  .option('-o, --output <path>', 'Output directory or file path', '.')
  .action(async (id: string, opts) => {
    const { exportCommand } = await import('./commands/export.js');
    await exportCommand(id, { output: opts.output });
  });

// ===== import =====
program
  .command('import <file>')
  .description('Import and verify a .ithilien-bundle file')
  .action(async (file: string) => {
    const { importCommand } = await import('./commands/import.js');
    await importCommand(file);
  });

// ===== keygen =====
program
  .command('keygen')
  .description('Generate an Ed25519 signing keypair for session signing')
  .option('--force', 'Overwrite existing key')
  .action(async (opts) => {
    const { keygenCommand } = await import('./commands/keygen.js');
    await keygenCommand({ force: opts.force ?? false });
  });

program.parse();
