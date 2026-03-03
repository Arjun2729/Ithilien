import { createHash } from 'node:crypto';
import type { Session, VerificationResult } from '../types.js';
import { hashEvent } from './hasher.js';
import { verifySignature } from './signer.js';

/**
 * Verify the integrity of a session by replaying its hash chain
 * and comparing against the stored manifest.
 */
export function verifySession(session: Session): VerificationResult {
  const manifest = session.manifest;

  if (!manifest) {
    return {
      valid: false,
      sessionId: session.id,
      rootHash: 'none',
      eventCount: session.events.length,
      details:
        'Session has no manifest. It was created before integrity tracking was enabled.',
    };
  }

  // Verify event count matches
  if (manifest.eventCount !== session.events.length) {
    return {
      valid: false,
      sessionId: session.id,
      rootHash: manifest.rootHash,
      eventCount: session.events.length,
      details: `Event count mismatch: manifest says ${manifest.eventCount}, session has ${session.events.length}`,
    };
  }

  // Rebuild hash chain and compare
  let previousHash = '0'.repeat(64);

  for (let i = 0; i < session.events.length; i++) {
    const eventHash = hashEvent(session.events[i]);
    const expectedChainHash = createHash('sha256')
      .update(eventHash + previousHash)
      .digest('hex');

    const recorded = manifest.eventHashes[i];

    if (!recorded || recorded.chainHash !== expectedChainHash) {
      return {
        valid: false,
        sessionId: session.id,
        rootHash: manifest.rootHash,
        eventCount: session.events.length,
        brokenChainAt: i,
        details: `Hash chain broken at event ${i}: expected ${expectedChainHash}, got ${recorded?.chainHash || 'missing'}`,
      };
    }

    previousHash = expectedChainHash;
  }

  // Verify root hash
  const allChainHashes = manifest.eventHashes.map((e) => e.chainHash).join('');
  const computedRoot = createHash('sha256').update(allChainHashes).digest('hex');

  if (computedRoot !== manifest.rootHash) {
    return {
      valid: false,
      sessionId: session.id,
      rootHash: manifest.rootHash,
      eventCount: session.events.length,
      details: `Root hash mismatch: computed ${computedRoot}, recorded ${manifest.rootHash}`,
    };
  }

  // Verify signature if present
  let signatureValid: boolean | undefined;
  if (manifest.signature && manifest.publicKey) {
    signatureValid = verifySignature(
      manifest.rootHash,
      manifest.signature,
      manifest.publicKey,
    );
    if (!signatureValid) {
      return {
        valid: false,
        sessionId: session.id,
        rootHash: manifest.rootHash,
        eventCount: session.events.length,
        signatureValid: false,
        details:
          'Signature verification failed. The session may have been tampered with after signing.',
      };
    }
  }

  return {
    valid: true,
    sessionId: session.id,
    rootHash: manifest.rootHash,
    eventCount: session.events.length,
    signatureValid,
    details: `Integrity verified. ${session.events.length} events, hash chain intact.${signatureValid ? ' Signature valid.' : ''}`,
  };
}
