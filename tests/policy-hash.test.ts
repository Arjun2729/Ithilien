import { describe, it, expect } from 'vitest';
import { computePolicyHash, buildPolicyContext, POLICY_HASH_ALGORITHM } from '../src/policy/hash.js';
import { DEFAULT_POLICY } from '../src/policy/defaults.js';
import type { PolicyFile } from '../src/policy/types.js';

describe('computePolicyHash', () => {
  it('produces a deterministic SHA-256 hex hash', () => {
    const hash = computePolicyHash(DEFAULT_POLICY);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the same hash for the same input', () => {
    const hash1 = computePolicyHash(DEFAULT_POLICY);
    const hash2 = computePolicyHash(DEFAULT_POLICY);
    expect(hash1).toBe(hash2);
  });

  it('returns a different hash when policy content changes', () => {
    const modified = structuredClone(DEFAULT_POLICY);
    modified.defaultAction = 'deny';
    const hashOriginal = computePolicyHash(DEFAULT_POLICY);
    const hashModified = computePolicyHash(modified);
    expect(hashOriginal).not.toBe(hashModified);
  });

  it('is insensitive to property insertion order', () => {
    const policy1: PolicyFile = {
      version: 1,
      description: 'test',
      defaultAction: 'allow',
      defaultRisk: 'low',
      commands: [],
    };
    // Same fields, different insertion order
    const policy2 = {
      defaultRisk: 'low',
      commands: [],
      version: 1,
      description: 'test',
      defaultAction: 'allow',
    } as PolicyFile;

    expect(computePolicyHash(policy1)).toBe(computePolicyHash(policy2));
  });
});

describe('buildPolicyContext', () => {
  it('collects unique sources from tagged rules', () => {
    const policy: PolicyFile = {
      version: 1,
      defaultAction: 'allow',
      defaultRisk: 'low',
      commands: [
        { name: 'a', pattern: 'a', action: 'allow', risk: 'low', category: 'shell', source: 'default-policy' },
        { name: 'b', pattern: 'b', action: 'deny', risk: 'high', category: 'shell', source: 'project-policy' },
        { name: 'c', pattern: 'c', action: 'log', risk: 'medium', category: 'shell', source: 'default-policy' },
      ],
    };
    const ctx = buildPolicyContext(policy, { engineVersion: '0.1.0' });
    expect(ctx.sources).toEqual(['default-policy', 'project-policy']);
  });

  it('includes policyPath only when provided', () => {
    const policy: PolicyFile = { version: 1, defaultAction: 'allow', defaultRisk: 'low', commands: [] };

    const withPath = buildPolicyContext(policy, { policyPath: '/custom/policy.json', engineVersion: '0.1.0' });
    expect(withPath.policyPath).toBe('/custom/policy.json');

    const withoutPath = buildPolicyContext(policy, { engineVersion: '0.1.0' });
    expect(withoutPath).not.toHaveProperty('policyPath');
  });

  it('includes the engine version', () => {
    const policy: PolicyFile = { version: 1, defaultAction: 'allow', defaultRisk: 'low', commands: [] };
    const ctx = buildPolicyContext(policy, { engineVersion: '1.2.3' });
    expect(ctx.engineVersion).toBe('1.2.3');
  });

  it('computes policyHash from the policy content', () => {
    const policy: PolicyFile = { version: 1, defaultAction: 'allow', defaultRisk: 'low', commands: [] };
    const ctx = buildPolicyContext(policy, { engineVersion: '0.1.0' });
    expect(ctx.policyHash).toBe(computePolicyHash(policy));
  });

  it('includes hashAlgorithm in the context', () => {
    const policy: PolicyFile = { version: 1, defaultAction: 'allow', defaultRisk: 'low', commands: [] };
    const ctx = buildPolicyContext(policy, { engineVersion: '0.1.0' });
    expect(ctx.hashAlgorithm).toBe(POLICY_HASH_ALGORITHM);
    expect(ctx.hashAlgorithm).toBe('sha256');
  });
});
