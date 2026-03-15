import { createHash } from 'node:crypto';
import type { PolicyFile } from './types.js';
import type { PolicyContext } from '../types.js';

/** The hash algorithm used for policy content hashing. */
export const POLICY_HASH_ALGORITHM = 'sha256';

/**
 * JSON replacer that sorts object keys at every level for deterministic output.
 *
 * Unlike the array-form replacer used in hashEvent() (which only works for
 * flat objects), this function-form replacer handles nested objects like
 * PolicyFile → commands[] → CommandRule.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Compute a deterministic SHA-256 hash of a merged PolicyFile.
 *
 * Uses recursive sorted-key JSON serialization so that identical policies
 * always produce the same hash regardless of property insertion order.
 */
export function computePolicyHash(policy: PolicyFile): string {
  const content = JSON.stringify(policy, sortedReplacer);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Build a PolicyContext from the loaded policy and options.
 *
 * Collects unique source labels from the merged rules and computes
 * a content hash of the full policy.
 */
export function buildPolicyContext(
  policy: PolicyFile,
  options: { policyPath?: string; engineVersion: string },
): PolicyContext {
  const sourceSet = new Set<string>();
  for (const rule of policy.commands) {
    if (rule.source) sourceSet.add(rule.source);
  }

  return {
    sources: [...sourceSet].sort(),
    policyHash: computePolicyHash(policy),
    ...(options.policyPath ? { policyPath: options.policyPath } : {}),
    engineVersion: options.engineVersion,
    hashAlgorithm: POLICY_HASH_ALGORITHM,
  };
}
