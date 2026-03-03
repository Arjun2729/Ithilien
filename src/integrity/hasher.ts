import { createHash } from 'node:crypto';
import type { SessionEvent, EventHash } from '../types.js';

/**
 * Hash a single event deterministically by sorting its keys.
 */
export function hashEvent(event: SessionEvent): string {
  const content = JSON.stringify(event, Object.keys(event).sort());
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Build a hash chain from an array of session events.
 * Each event's chainHash = SHA-256(eventHash + previousChainHash).
 * The first event chains from a genesis hash of 64 zeros.
 */
export function buildHashChain(events: SessionEvent[]): EventHash[] {
  const chain: EventHash[] = [];
  let previousHash = '0'.repeat(64);

  for (let i = 0; i < events.length; i++) {
    const eventHash = hashEvent(events[i]);
    const chainHash = createHash('sha256')
      .update(eventHash + previousHash)
      .digest('hex');

    chain.push({
      eventIndex: i,
      eventHash,
      previousHash,
      chainHash,
    });

    previousHash = chainHash;
  }

  return chain;
}

/**
 * Compute a root hash from a completed hash chain.
 * Root = SHA-256 of all chainHashes concatenated.
 */
export function computeRootHash(chain: EventHash[]): string {
  const allChainHashes = chain.map((e) => e.chainHash).join('');
  return createHash('sha256').update(allChainHashes).digest('hex');
}
