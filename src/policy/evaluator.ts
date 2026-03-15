import type { PolicyFile, PolicyDecision, CommandRule } from './types.js';
import { classifyCommand } from './classifier.js';

/**
 * Evaluate a command string against a loaded policy.
 *
 * Evaluation order:
 * 1. Normalize the command (trim, collapse whitespace)
 * 2. Check each command rule in order (first match wins)
 * 3. If no rule matches, use the built-in classifier for category/risk
 * 4. Apply the policy's defaultAction
 *
 * This is a pure function with no side effects.
 *
 * ## Command normalization
 *
 * Before matching, commands are normalized by:
 * - Trimming leading/trailing whitespace
 * - Collapsing runs of whitespace to a single space
 *
 * What is NOT normalized (by design):
 * - Shell expansion ($VAR, $(cmd), backticks)
 * - Alias resolution
 * - Path resolution (/usr/bin/git vs git)
 * - Quoting or escaping
 *
 * Pattern matching operates on the raw command string after normalization.
 * This means obfuscated commands (e.g. base64-encoded, variable-interpolated)
 * will bypass pattern matching. This is documented as a known limitation
 * in SECURITY.md.
 */
export function evaluateCommand(command: string, policy: PolicyFile): PolicyDecision {
  const normalized = normalizeCommand(command);

  // Check explicit policy rules (first match wins)
  for (const rule of policy.commands) {
    if (matchesRule(normalized, rule)) {
      return {
        action: rule.action,
        risk: rule.risk,
        category: rule.category,
        matchedRule: rule.name,
        source: rule.source ?? 'default-policy',
        reason: rule.description ?? `Matched rule: ${rule.name}`,
      };
    }
  }

  // No explicit rule matched — classify and apply default
  const classification = classifyCommand(normalized);

  return {
    action: policy.defaultAction,
    risk: classification.risk,
    category: classification.category,
    matchedRule: null,
    source: 'classifier-fallback',
    reason: classification.matchedPatterns.length > 0
      ? `No policy rule matched. Classifier detected: ${classification.reason}`
      : 'No policy rule or built-in pattern matched',
  };
}

/**
 * Normalize a command string for consistent pattern matching.
 *
 * - Trims leading/trailing whitespace
 * - Collapses internal runs of whitespace to a single space
 *
 * This ensures "rm  -rf" matches the same patterns as "rm -rf".
 */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

/**
 * Test whether a command matches a rule's pattern.
 * Patterns are always regex strings.
 */
function matchesRule(command: string, rule: CommandRule): boolean {
  try {
    const regex = new RegExp(rule.pattern);
    return regex.test(command);
  } catch {
    // Invalid regex in rule — skip it (validation should catch this earlier)
    return false;
  }
}
