import chalk from 'chalk';
import { loadSession, setSessionsDir } from '../audit/session.js';
import { verifySession } from '../integrity/verifier.js';
import { loadConfig } from '../config/loader.js';

export async function verifyCommand(id: string): Promise<void> {
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

  const result = verifySession(session);

  console.log('');
  if (result.valid) {
    console.log(chalk.green('  ✓') + chalk.bold.white(` Session ${id}: integrity verified`));
  } else {
    console.log(chalk.red('  ✗') + chalk.bold.white(` Session ${id}: integrity check FAILED`));
  }

  console.log('');
  console.log(`  ${chalk.dim('Root hash:')}  ${chalk.white(result.rootHash)}`);
  console.log(`  ${chalk.dim('Events:')}     ${chalk.white(String(result.eventCount))}${result.valid ? chalk.dim(' (chain intact)') : ''}`);

  if (result.brokenChainAt !== undefined) {
    console.log(`  ${chalk.dim('Broken at:')} ${chalk.red(`event ${result.brokenChainAt}`)}`);
  }

  // Signature status
  if (result.signatureValid === true) {
    console.log(`  ${chalk.dim('Signed:')}     ${chalk.green('✓ Ed25519')}`);
  } else if (result.signatureValid === false) {
    console.log(`  ${chalk.dim('Signed:')}     ${chalk.red('✗ INVALID')}`);
  } else {
    console.log(`  ${chalk.dim('Signed:')}     ${chalk.dim('Not signed')}`);
  }

  // Environment fingerprint
  const manifest = session.manifest;
  if (manifest) {
    const fp = manifest.fingerprint;
    console.log(
      `  ${chalk.dim('Environment:')} ${chalk.white(fp.dockerImageTag)} ${chalk.dim(`(${fp.dockerImageId.slice(0, 19)}...)`)}`,
    );
    console.log(
      `  ${chalk.dim('Profile:')}     ${chalk.white(fp.guardrailProfile)}, network: ${chalk.white(fp.networkMode)}`,
    );
    console.log(
      `  ${chalk.dim('Duration:')}    ${chalk.white(manifest.firstEventAt)} → ${chalk.white(manifest.lastEventAt)}`,
    );
  }

  console.log('');

  if (!result.valid) {
    console.log(chalk.red(`  ${result.details}`));
    console.log('');
    process.exit(1);
  }
}
