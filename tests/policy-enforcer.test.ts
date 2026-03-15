import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enforceDecision, formatDecisionMessage } from '../src/policy/enforcer.js';
import type { PolicyDecision } from '../src/policy/types.js';

describe('enforcer', () => {
  const allowDecision: PolicyDecision = {
    action: 'allow',
    risk: 'low',
    category: 'package',
    matchedRule: 'npm-install',
    source: 'default-policy',
    reason: 'npm package installation',
  };

  const denyDecision: PolicyDecision = {
    action: 'deny',
    risk: 'critical',
    category: 'network',
    matchedRule: 'pipe-to-shell',
    source: 'default-policy',
    reason: 'Piping remote content to shell is extremely dangerous',
  };

  const logDecision: PolicyDecision = {
    action: 'log',
    risk: 'medium',
    category: 'network',
    matchedRule: 'network-download',
    source: 'default-policy',
    reason: 'Network download operation',
  };

  const askDecision: PolicyDecision = {
    action: 'ask',
    risk: 'high',
    category: 'filesystem',
    matchedRule: 'recursive-force-delete',
    source: 'default-policy',
    reason: 'Recursive force delete can cause irreversible data loss',
  };

  describe('allow action', () => {
    it('proceeds on allow', async () => {
      const result = await enforceDecision(allowDecision);
      expect(result.proceed).toBe(true);
      expect(result.decision).toBe(allowDecision);
    });
  });

  describe('log action', () => {
    it('proceeds on log', async () => {
      const result = await enforceDecision(logDecision);
      expect(result.proceed).toBe(true);
      expect(result.decision).toBe(logDecision);
    });
  });

  describe('deny action', () => {
    it('blocks on deny', async () => {
      const result = await enforceDecision(denyDecision);
      expect(result.proceed).toBe(false);
      expect(result.decision).toBe(denyDecision);
    });
  });

  describe('ask action', () => {
    it('fails closed when stdin is not a TTY', async () => {
      // In test environment, stdin is not a TTY
      const result = await enforceDecision(askDecision);
      expect(result.proceed).toBe(false);
      expect(result.resolution).toBe('denied-non-interactive');
    });
  });

  describe('formatDecisionMessage', () => {
    it('formats a deny decision with rule', () => {
      const msg = formatDecisionMessage(denyDecision);
      expect(msg).toContain('DENY');
      expect(msg).toContain('CRITICAL');
      expect(msg).toContain('network');
      expect(msg).toContain('pipe-to-shell');
      expect(msg).toContain('default-policy');
    });

    it('formats a decision without a matched rule', () => {
      const decision: PolicyDecision = {
        action: 'deny',
        risk: 'medium',
        category: 'unknown',
        matchedRule: null,
        source: 'classifier-fallback',
        reason: 'No rule matched',
      };
      const msg = formatDecisionMessage(decision);
      expect(msg).toContain('DENY');
      expect(msg).toContain('classifier-fallback');
    });

    it('formats an ask decision', () => {
      const msg = formatDecisionMessage(askDecision);
      expect(msg).toContain('ASK');
      expect(msg).toContain('HIGH');
      expect(msg).toContain('recursive-force-delete');
    });
  });
});
