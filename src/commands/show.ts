import chalk from 'chalk';
import { loadSession, computeSummary, setSessionsDir } from '../audit/session.js';
import { renderAuditTrail, renderHTMLReport } from '../audit/report.js';
import { loadConfig } from '../config/loader.js';
import { verifySession } from '../integrity/verifier.js';

export async function showCommand(id: string, format: string): Promise<void> {
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

  const summary = session.summary ?? computeSummary(session);

  if (format === 'html') {
    console.log(renderHTMLReport(session, summary));
  } else {
    console.log(renderAuditTrail(session));

    // Show integrity status
    if (session.manifest) {
      const result = verifySession(session);
      if (result.valid) {
        console.log(`  ${chalk.dim('Integrity:')} ${chalk.green('✓ Verified')} ${chalk.dim(`(root hash: ${result.rootHash.slice(0, 16)}...)`)}`);
      } else {
        console.log(`  ${chalk.dim('Integrity:')} ${chalk.red('✗ FAILED')} ${chalk.dim(`— ${result.details}`)}`);
      }

      if (result.signatureValid === true) {
        console.log(`  ${chalk.dim('Signed:')}    ${chalk.green('✓ Ed25519')}`);
      } else if (result.signatureValid === false) {
        console.log(`  ${chalk.dim('Signed:')}    ${chalk.red('✗ INVALID')}`);
      } else {
        console.log(`  ${chalk.dim('Signed:')}    ${chalk.dim('Not signed')}`);
      }

      const fp = session.manifest.fingerprint;
      console.log(`  ${chalk.dim('Environment:')} ${chalk.white(fp.dockerImageTag)} ${chalk.dim(`(${fp.dockerImageId.slice(0, 19)}...)`)}, profile: ${chalk.white(fp.guardrailProfile)}`);
      console.log('');
    } else {
      console.log(`  ${chalk.dim('Integrity:')} ${chalk.dim('— No manifest (pre-integrity session)')}`);
      console.log('');
    }
  }
}
