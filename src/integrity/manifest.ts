import type { Session, SessionManifest, EnvironmentFingerprint } from '../types.js';
import { buildHashChain, computeRootHash } from './hasher.js';

/**
 * Generate a session manifest with hash chain and root hash.
 * Call this after a session completes and all events are finalized.
 */
export function generateManifest(
  session: Session,
  fingerprint: EnvironmentFingerprint,
): SessionManifest {
  const eventHashes = buildHashChain(session.events);
  const rootHash = computeRootHash(eventHashes);

  return {
    version: 1,
    sessionId: session.id,
    rootHash,
    eventCount: session.events.length,
    firstEventAt: session.events[0]?.timestamp || session.startedAt,
    lastEventAt:
      session.events[session.events.length - 1]?.timestamp || session.startedAt,
    fingerprint,
    eventHashes,
  };
}
