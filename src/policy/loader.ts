import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import type { PolicyFile, PolicySource } from './types.js';
import { DEFAULT_POLICY } from './defaults.js';

const PROJECT_POLICY_DIR = '.ithilien';
const GLOBAL_POLICY_DIR = join(homedir(), '.ithilien');

/**
 * Validation errors found in a policy file.
 */
export interface PolicyValidationError {
  field: string;
  message: string;
}

/**
 * Non-fatal warning emitted during policy loading.
 */
export interface PolicyWarning {
  message: string;
}

/**
 * Result of loading a policy, including any warnings.
 */
export interface PolicyLoadResult {
  policy: PolicyFile;
  warnings: PolicyWarning[];
}

/**
 * Options for loading a policy.
 */
export interface PolicyLoadOptions {
  /** Project directory for .ithilien/policy.json discovery */
  projectPath?: string;
  /** Explicit policy file path (--policy flag; overrides project discovery) */
  policyPath?: string;
}

/**
 * Load policy by merging: built-in defaults < global < project-level (or explicit).
 *
 * Policy files are loaded from:
 * 1. Built-in defaults (always present, source: 'default-policy')
 * 2. ~/.ithilien/policy.json (global overrides, source: 'global-policy')
 * 3. One of:
 *    a. Explicit --policy path (source: 'cli-override')
 *    b. .ithilien/policy.json (project discovery, source: 'project-policy')
 *
 * Rules from higher-priority sources are prepended, so they match first.
 * Returns the merged policy plus any warnings about unsupported features.
 */
export async function loadPolicy(options: PolicyLoadOptions = {}): Promise<PolicyLoadResult> {
  const warnings: PolicyWarning[] = [];

  // Start with defaults, tagged with source
  let policy = tagRules(structuredClone(DEFAULT_POLICY), 'default-policy');

  // Global policy
  const globalPath = join(GLOBAL_POLICY_DIR, 'policy.json');
  const globalPolicy = await loadPolicyFile(globalPath);
  if (globalPolicy) {
    collectUnsupportedWarnings(globalPolicy, globalPath, warnings);
    policy = mergePolicy(policy, tagRulesPartial(globalPolicy, 'global-policy'));
  }

  // Explicit policy path (--policy) or project discovery
  if (options.policyPath) {
    if (!existsSync(options.policyPath)) {
      throw new Error(`Policy file not found: ${options.policyPath}`);
    }
    const explicit = await loadPolicyFile(options.policyPath);
    if (explicit) {
      collectUnsupportedWarnings(explicit, options.policyPath, warnings);
      policy = mergePolicy(policy, tagRulesPartial(explicit, 'cli-override'));
    }
  } else if (options.projectPath) {
    const projectPolicyPath = join(options.projectPath, PROJECT_POLICY_DIR, 'policy.json');
    const projectPolicy = await loadPolicyFile(projectPolicyPath);
    if (projectPolicy) {
      collectUnsupportedWarnings(projectPolicy, projectPolicyPath, warnings);
      policy = mergePolicy(policy, tagRulesPartial(projectPolicy, 'project-policy'));
    }
  }

  return { policy, warnings };
}

/**
 * Load and validate a single policy JSON file.
 * Returns null if the file doesn't exist.
 * Throws if the file exists but is invalid.
 */
async function loadPolicyFile(path: string): Promise<Partial<PolicyFile> | null> {
  if (!existsSync(path)) return null;

  const raw = await readFile(path, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in policy file: ${path}`);
  }

  const errors = validatePolicyFile(parsed);
  if (errors.length > 0) {
    const details = errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Invalid policy file ${path}:\n${details}`);
  }

  return parsed as Partial<PolicyFile>;
}

/**
 * Warn when a policy file contains rule types that aren't enforced yet.
 * These are not errors — the file is valid — but the rules will be ignored.
 */
function collectUnsupportedWarnings(
  policy: Partial<PolicyFile>,
  path: string,
  warnings: PolicyWarning[],
): void {
  if (policy.paths && policy.paths.length > 0) {
    warnings.push({
      message: `${path}: contains ${policy.paths.length} path rule(s) — path rules are not enforced yet and will be ignored`,
    });
  }
  if (policy.network && policy.network.length > 0) {
    warnings.push({
      message: `${path}: contains ${policy.network.length} network rule(s) — network rules are not enforced yet and will be ignored`,
    });
  }
}

/**
 * Tag all command rules in a full PolicyFile with their source.
 */
function tagRules(policy: PolicyFile, source: PolicySource): PolicyFile {
  for (const rule of policy.commands) {
    rule.source = source;
  }
  return policy;
}

/**
 * Tag all command rules in a partial policy with their source.
 */
function tagRulesPartial(policy: Partial<PolicyFile>, source: PolicySource): Partial<PolicyFile> {
  if (policy.commands) {
    for (const rule of policy.commands) {
      rule.source = source;
    }
  }
  return policy;
}

/**
 * Validate a parsed policy object.
 * Returns an array of validation errors (empty = valid).
 */
export function validatePolicyFile(obj: unknown): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    errors.push({ field: 'root', message: 'Policy must be a JSON object' });
    return errors;
  }

  const policy = obj as Record<string, unknown>;

  // Version check
  if (policy.version !== undefined && policy.version !== 1) {
    errors.push({ field: 'version', message: `Unsupported version: ${policy.version}. Only version 1 is supported.` });
  }

  // defaultAction check
  const validActions = ['allow', 'deny', 'ask', 'log'];
  if (policy.defaultAction !== undefined && !validActions.includes(policy.defaultAction as string)) {
    errors.push({ field: 'defaultAction', message: `Must be one of: ${validActions.join(', ')}` });
  }

  // defaultRisk check
  const validRisks = ['low', 'medium', 'high', 'critical'];
  if (policy.defaultRisk !== undefined && !validRisks.includes(policy.defaultRisk as string)) {
    errors.push({ field: 'defaultRisk', message: `Must be one of: ${validRisks.join(', ')}` });
  }

  // Command rules validation
  if (policy.commands !== undefined) {
    if (!Array.isArray(policy.commands)) {
      errors.push({ field: 'commands', message: 'Must be an array' });
    } else {
      for (let i = 0; i < policy.commands.length; i++) {
        const ruleErrors = validateCommandRule(policy.commands[i], i);
        errors.push(...ruleErrors);
      }
    }
  }

  return errors;
}

/**
 * Validate a single command rule.
 */
function validateCommandRule(rule: unknown, index: number): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];
  const prefix = `commands[${index}]`;

  if (typeof rule !== 'object' || rule === null) {
    errors.push({ field: prefix, message: 'Must be an object' });
    return errors;
  }

  const r = rule as Record<string, unknown>;

  if (typeof r.name !== 'string' || r.name.length === 0) {
    errors.push({ field: `${prefix}.name`, message: 'Required, must be a non-empty string' });
  }

  if (typeof r.pattern !== 'string' || r.pattern.length === 0) {
    errors.push({ field: `${prefix}.pattern`, message: 'Required, must be a non-empty string' });
  } else {
    // Verify pattern is a valid regex
    try {
      new RegExp(r.pattern);
    } catch {
      errors.push({ field: `${prefix}.pattern`, message: `Invalid regex: ${r.pattern}` });
    }
  }

  const validActions = ['allow', 'deny', 'ask', 'log'];
  if (!validActions.includes(r.action as string)) {
    errors.push({ field: `${prefix}.action`, message: `Required, must be one of: ${validActions.join(', ')}` });
  }

  const validRisks = ['low', 'medium', 'high', 'critical'];
  if (!validRisks.includes(r.risk as string)) {
    errors.push({ field: `${prefix}.risk`, message: `Required, must be one of: ${validRisks.join(', ')}` });
  }

  const validCategories = ['filesystem', 'network', 'package', 'git', 'process', 'system', 'shell', 'unknown'];
  if (!validCategories.includes(r.category as string)) {
    errors.push({ field: `${prefix}.category`, message: `Required, must be one of: ${validCategories.join(', ')}` });
  }

  return errors;
}

/**
 * Merge an override policy on top of a base policy.
 *
 * Override rules are prepended to the command list so they take
 * priority (first-match-wins). Scalar fields are overwritten.
 */
function mergePolicy(base: PolicyFile, override: Partial<PolicyFile>): PolicyFile {
  return {
    version: 1,
    description: override.description ?? base.description,
    defaultAction: override.defaultAction ?? base.defaultAction,
    defaultRisk: override.defaultRisk ?? base.defaultRisk,
    // Override rules come first (higher priority)
    commands: [
      ...(override.commands ?? []),
      ...base.commands,
    ],
    paths: [
      ...(override.paths ?? []),
      ...(base.paths ?? []),
    ],
    network: [
      ...(override.network ?? []),
      ...(base.network ?? []),
    ],
  };
}
