// ===== Policy Engine Types =====

/**
 * Risk level for commands and actions.
 * Used by the classifier and evaluator to communicate severity.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Action the policy engine decides to take.
 * - allow: execute without intervention
 * - deny: block execution
 * - ask: require human approval before execution
 * - log: allow but record as noteworthy
 */
export type PolicyAction = 'allow' | 'deny' | 'ask' | 'log';

/**
 * Where a policy decision originated from.
 */
export type PolicySource =
  | 'default-policy'
  | 'global-policy'
  | 'project-policy'
  | 'cli-override'
  | 'classifier-fallback';

/**
 * Broad category for classifying commands.
 */
export type CommandCategory =
  | 'filesystem'
  | 'network'
  | 'package'
  | 'git'
  | 'process'
  | 'system'
  | 'shell'
  | 'unknown';

/**
 * A single command-matching rule in a policy file.
 * Rules are evaluated in order; first match wins.
 */
export interface CommandRule {
  /** Human-readable name for this rule */
  name: string;
  /** Regex pattern to match against the full command string */
  pattern: string;
  /** Action to take when matched */
  action: PolicyAction;
  /** Risk level */
  risk: RiskLevel;
  /** Command category */
  category: CommandCategory;
  /** Explanation shown when rule triggers */
  description?: string;
  /**
   * Set by the loader to track where this rule came from.
   * Not expected in policy files — set programmatically during merge.
   */
  source?: PolicySource;
}

/**
 * Path-based access rule (for future use in Phase 2+).
 */
export interface PathRule {
  /** Glob pattern for file paths */
  pattern: string;
  /** Action for matching paths */
  action: PolicyAction;
  /** Risk level */
  risk: RiskLevel;
  /** Explanation */
  description?: string;
}

/**
 * Network destination rule (for future use in Phase 2+).
 */
export interface NetworkRule {
  /** Domain or IP pattern */
  destination: string;
  /** Action */
  action: PolicyAction;
  /** Risk level */
  risk: RiskLevel;
  /** Explanation */
  description?: string;
}

/**
 * Top-level policy file format.
 * Loaded from .ithilien/policy.json or ~/.ithilien/policy.json.
 */
export interface PolicyFile {
  /** Schema version (currently 1) */
  version: 1;
  /** Optional human-readable description */
  description?: string;
  /** Default action when no command rule matches */
  defaultAction: PolicyAction;
  /** Default risk level for unmatched commands */
  defaultRisk: RiskLevel;
  /** Command rules, evaluated in order (first match wins) */
  commands: CommandRule[];
  /** Path rules (reserved for Phase 2+) */
  paths?: PathRule[];
  /** Network rules (reserved for Phase 2+) */
  network?: NetworkRule[];
}

/**
 * Result of evaluating a command against a policy.
 */
export interface PolicyDecision {
  /** The decided action */
  action: PolicyAction;
  /** Risk level of the command */
  risk: RiskLevel;
  /** Category of the command */
  category: CommandCategory;
  /** Name of the rule that matched, or null if default */
  matchedRule: string | null;
  /** Where the decision came from */
  source: PolicySource;
  /** Human-readable reason for the decision */
  reason: string;
}

/**
 * Result of the built-in command classifier (no policy file needed).
 */
export interface ClassificationResult {
  /** Command category */
  category: CommandCategory;
  /** Assessed risk level */
  risk: RiskLevel;
  /** Which built-in patterns matched */
  matchedPatterns: string[];
  /** Human-readable explanation */
  reason: string;
}
