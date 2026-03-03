import chalk from 'chalk';
import { createHash } from 'node:crypto';
import {
  hasSigningKey,
  generateSigningKey,
} from '../integrity/signer.js';

export async function keygenCommand(opts: { force?: boolean }): Promise<void> {
  console.log('');

  if (hasSigningKey() && !opts.force) {
    console.log(
      chalk.yellow('  ⚠') +
        chalk.white(' A signing key already exists at ~/.ithilien/signing-key'),
    );
    console.log(chalk.dim('  Use --force to overwrite.'));
    console.log('');
    return;
  }

  const { publicKey, privatePath, publicPath } = generateSigningKey();

  // Compute public key fingerprint
  const fingerprint = createHash('sha256')
    .update(publicKey)
    .digest('hex')
    .slice(0, 32);

  console.log(
    chalk.green('  ✓') + chalk.white(' Ed25519 signing keypair generated'),
  );
  console.log('');
  console.log(`  ${chalk.dim('Private key:')} ${chalk.white(privatePath)}`);
  console.log(`  ${chalk.dim('Public key:')}  ${chalk.white(publicPath)}`);
  console.log(`  ${chalk.dim('Fingerprint:')} ${chalk.white(fingerprint)}`);
  console.log('');
  console.log(
    chalk.dim(
      '  Sessions will now be automatically signed with this key.',
    ),
  );
  console.log('');
}
