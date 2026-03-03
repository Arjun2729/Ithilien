import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPairSync, sign, createPrivateKey } from 'node:crypto';
import { verifySignature } from '../src/integrity/signer.js';

describe('signer', () => {
  // We test verifySignature directly with generated keys to avoid
  // writing to the real ~/.ithilien directory during tests.
  let publicKeyPem: string;
  let validSignature: string;
  const rootHash = 'a'.repeat(64);

  beforeAll(() => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKeyPem = publicKey;
    const privKey = createPrivateKey(privateKey);
    validSignature = sign(null, Buffer.from(rootHash), privKey).toString('base64');
  });

  it('verifies a valid signature', () => {
    const result = verifySignature(rootHash, validSignature, publicKeyPem);
    expect(result).toBe(true);
  });

  it('rejects a signature for wrong data', () => {
    const wrongHash = 'b'.repeat(64);
    const result = verifySignature(wrongHash, validSignature, publicKeyPem);
    expect(result).toBe(false);
  });

  it('rejects a corrupted signature', () => {
    const result = verifySignature(rootHash, 'corrupted!!!', publicKeyPem);
    expect(result).toBe(false);
  });

  it('rejects signature with wrong key', () => {
    const otherKeypair = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const result = verifySignature(rootHash, validSignature, otherKeypair.publicKey);
    expect(result).toBe(false);
  });
});
