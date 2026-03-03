import { describe, it, expect } from 'vitest';
import { hashEvent, buildHashChain, computeRootHash } from '../src/integrity/hasher.js';
import type { SessionEvent } from '../src/types.js';

describe('hasher', () => {
  const event1: SessionEvent = {
    type: 'command_start',
    timestamp: '2026-01-01T00:00:00.000Z',
    command: 'echo hello',
  };
  const event2: SessionEvent = {
    type: 'file_created',
    timestamp: '2026-01-01T00:01:00.000Z',
    path: 'test.ts',
    size: 42,
  };
  const event3: SessionEvent = {
    type: 'command_end',
    timestamp: '2026-01-01T00:02:00.000Z',
    exitCode: 0,
  };

  describe('hashEvent', () => {
    it('returns a 64-character hex SHA-256 hash', () => {
      const hash = hashEvent(event1);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic — same event always produces same hash', () => {
      const a = hashEvent(event1);
      const b = hashEvent(event1);
      expect(a).toBe(b);
    });

    it('produces different hashes for different events', () => {
      const h1 = hashEvent(event1);
      const h2 = hashEvent(event2);
      expect(h1).not.toBe(h2);
    });
  });

  describe('buildHashChain', () => {
    it('returns empty chain for empty events', () => {
      const chain = buildHashChain([]);
      expect(chain).toHaveLength(0);
    });

    it('uses genesis hash (64 zeros) as first previousHash', () => {
      const chain = buildHashChain([event1]);
      expect(chain[0].previousHash).toBe('0'.repeat(64));
    });

    it('chains events correctly — each previousHash is the prior chainHash', () => {
      const chain = buildHashChain([event1, event2, event3]);
      expect(chain).toHaveLength(3);
      expect(chain[0].eventIndex).toBe(0);
      expect(chain[1].eventIndex).toBe(1);
      expect(chain[2].eventIndex).toBe(2);

      expect(chain[1].previousHash).toBe(chain[0].chainHash);
      expect(chain[2].previousHash).toBe(chain[1].chainHash);
    });

    it('produces unique chainHashes for each event', () => {
      const chain = buildHashChain([event1, event2, event3]);
      const hashes = new Set(chain.map((e) => e.chainHash));
      expect(hashes.size).toBe(3);
    });
  });

  describe('computeRootHash', () => {
    it('returns a 64-character hex hash', () => {
      const chain = buildHashChain([event1, event2]);
      const root = computeRootHash(chain);
      expect(root).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same chain', () => {
      const chain = buildHashChain([event1, event2, event3]);
      const a = computeRootHash(chain);
      const b = computeRootHash(chain);
      expect(a).toBe(b);
    });

    it('changes when any event in the chain changes', () => {
      const chain1 = buildHashChain([event1, event2]);
      const chain2 = buildHashChain([event1, event3]);
      expect(computeRootHash(chain1)).not.toBe(computeRootHash(chain2));
    });
  });
});
