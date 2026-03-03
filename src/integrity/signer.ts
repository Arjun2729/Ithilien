import {
  generateKeyPairSync,
  sign,
  verify,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const KEY_DIR = path.join(os.homedir(), '.ithilien');
const PRIVATE_KEY_PATH = path.join(KEY_DIR, 'signing-key');
const PUBLIC_KEY_PATH = path.join(KEY_DIR, 'signing-key.pub');

/**
 * Check whether a signing keypair exists.
 */
export function hasSigningKey(): boolean {
  return existsSync(PRIVATE_KEY_PATH);
}

/**
 * Generate a new Ed25519 keypair for session signing.
 */
export function generateSigningKey(): {
  publicKey: string;
  privatePath: string;
  publicPath: string;
} {
  mkdirSync(KEY_DIR, { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });

  return { publicKey, privatePath: PRIVATE_KEY_PATH, publicPath: PUBLIC_KEY_PATH };
}

/**
 * Sign a root hash with the local Ed25519 private key.
 */
export function signRootHash(rootHash: string): {
  signature: string;
  publicKey: string;
} {
  const privateKeyPem = readFileSync(PRIVATE_KEY_PATH, 'utf-8');
  const publicKeyPem = readFileSync(PUBLIC_KEY_PATH, 'utf-8');

  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign(null, Buffer.from(rootHash), privateKey).toString(
    'base64',
  );

  return { signature, publicKey: publicKeyPem };
}

/**
 * Verify an Ed25519 signature against a root hash.
 */
export function verifySignature(
  rootHash: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    const publicKey = createPublicKey(publicKeyPem);
    return verify(
      null,
      Buffer.from(rootHash),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}
