import type { CommandCategory, RiskLevel, ClassificationResult } from './types.js';

/**
 * Built-in pattern definition for command classification.
 * These are evaluated in order; the highest-risk match determines the result.
 */
interface BuiltInPattern {
  name: string;
  pattern: RegExp;
  risk: RiskLevel;
  category: CommandCategory;
  reason: string;
}

/**
 * Built-in dangerous command patterns, ordered from most to least severe.
 *
 * These are heuristic. They match common dangerous patterns in shell commands.
 * They are NOT a security boundary — a determined agent can bypass pattern
 * matching by obfuscating commands. These exist to catch accidental or
 * naive dangerous operations.
 */
const BUILT_IN_PATTERNS: BuiltInPattern[] = [
  // --- Critical: likely destructive or dangerous beyond recovery ---
  {
    name: 'pipe-to-shell',
    pattern: /\b(curl|wget)\b.*\|\s*(ba)?sh\b/,
    risk: 'critical',
    category: 'network',
    reason: 'Piping remote content to shell',
  },
  {
    name: 'disk-format',
    pattern: /\bmkfs\b/,
    risk: 'critical',
    category: 'system',
    reason: 'Filesystem format operation',
  },
  {
    name: 'raw-device-write',
    pattern: />\s*\/dev\/sd[a-z]/,
    risk: 'critical',
    category: 'filesystem',
    reason: 'Write to raw block device',
  },
  {
    name: 'system-shutdown',
    pattern: /\b(shutdown|reboot|halt|poweroff)\b/,
    risk: 'critical',
    category: 'system',
    reason: 'System shutdown or reboot',
  },
  {
    name: 'git-force-push',
    pattern: /\bgit\s+push\b.*(\s--force\b|\s-f\b)/,
    risk: 'critical',
    category: 'git',
    reason: 'Force push can destroy remote history',
  },

  // --- High: significant risk, likely requires human judgment ---
  {
    name: 'recursive-force-delete',
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/,
    risk: 'high',
    category: 'filesystem',
    reason: 'Recursive force delete',
  },
  {
    name: 'rm-recursive',
    pattern: /\brm\s+(-[a-zA-Z]*r|--recursive)\b/,
    risk: 'high',
    category: 'filesystem',
    reason: 'Recursive delete',
  },
  {
    name: 'sudo',
    pattern: /\bsudo\b/,
    risk: 'high',
    category: 'system',
    reason: 'Privilege escalation',
  },
  {
    name: 'dd-command',
    pattern: /\bdd\s+/,
    risk: 'high',
    category: 'filesystem',
    reason: 'Raw disk operation',
  },
  {
    name: 'git-push',
    pattern: /\bgit\s+push\b/,
    risk: 'high',
    category: 'git',
    reason: 'Push to remote repository',
  },
  {
    name: 'git-hard-reset',
    pattern: /\bgit\s+reset\s+--hard\b/,
    risk: 'high',
    category: 'git',
    reason: 'Hard reset destroys uncommitted changes',
  },
  {
    name: 'git-clean-force',
    pattern: /\bgit\s+clean\s+(-[a-zA-Z]*f[a-zA-Z]*|--force)\b/,
    risk: 'high',
    category: 'git',
    reason: 'Force-clean removes untracked files',
  },
  {
    name: 'npm-publish',
    pattern: /\bnpm\s+publish\b/,
    risk: 'high',
    category: 'package',
    reason: 'Publishing package to registry',
  },
  {
    name: 'eval',
    pattern: /\beval\b/,
    risk: 'high',
    category: 'shell',
    reason: 'Dynamic code evaluation',
  },
  {
    name: 'chmod-world-writable',
    pattern: /\bchmod\s+777\b/,
    risk: 'high',
    category: 'filesystem',
    reason: 'World-writable permissions',
  },

  // --- Medium: noteworthy, should be logged ---
  {
    name: 'network-download',
    pattern: /\b(curl|wget)\b/,
    risk: 'medium',
    category: 'network',
    reason: 'Network download',
  },
  {
    name: 'chmod',
    pattern: /\bchmod\b/,
    risk: 'medium',
    category: 'filesystem',
    reason: 'Permission change',
  },
  {
    name: 'chown',
    pattern: /\bchown\b/,
    risk: 'medium',
    category: 'filesystem',
    reason: 'Ownership change',
  },
  {
    name: 'kill-process',
    pattern: /\b(kill|killall|pkill)\b/,
    risk: 'medium',
    category: 'process',
    reason: 'Process termination',
  },
  {
    name: 'docker-command',
    pattern: /\bdocker\b/,
    risk: 'medium',
    category: 'system',
    reason: 'Docker operation',
  },
  {
    name: 'env-file-access',
    pattern: /\.env\b/,
    risk: 'medium',
    category: 'filesystem',
    reason: 'Environment file access',
  },

  // --- Low: normal development operations ---
  {
    name: 'npm-install',
    pattern: /\bnpm\s+(install|ci|add)\b/,
    risk: 'low',
    category: 'package',
    reason: 'Package installation',
  },
  {
    name: 'pnpm-install',
    pattern: /\bpnpm\s+(install|add)\b/,
    risk: 'low',
    category: 'package',
    reason: 'Package installation',
  },
  {
    name: 'yarn-install',
    pattern: /\byarn\s+(install|add)\b/,
    risk: 'low',
    category: 'package',
    reason: 'Package installation',
  },
  {
    name: 'pip-install',
    pattern: /\bpip3?\s+install\b/,
    risk: 'low',
    category: 'package',
    reason: 'Package installation',
  },
  {
    name: 'git-commit',
    pattern: /\bgit\s+commit\b/,
    risk: 'low',
    category: 'git',
    reason: 'Git commit',
  },
  {
    name: 'git-clone',
    pattern: /\bgit\s+clone\b/,
    risk: 'low',
    category: 'git',
    reason: 'Repository clone',
  },
  {
    name: 'git-checkout',
    pattern: /\bgit\s+(checkout|switch)\b/,
    risk: 'low',
    category: 'git',
    reason: 'Branch switch',
  },
  {
    name: 'ls-command',
    pattern: /\bls\b/,
    risk: 'low',
    category: 'filesystem',
    reason: 'Directory listing',
  },
  {
    name: 'cat-command',
    pattern: /\bcat\b/,
    risk: 'low',
    category: 'filesystem',
    reason: 'File read',
  },
];

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * Classify a shell command string using built-in heuristic patterns.
 *
 * Returns the highest-risk match found. If no patterns match,
 * returns category 'unknown' with risk 'low'.
 *
 * This is heuristic-based and NOT a security boundary.
 * Commands can be obfuscated to bypass these patterns.
 */
export function classifyCommand(command: string): ClassificationResult {
  const matches: BuiltInPattern[] = [];

  for (const pat of BUILT_IN_PATTERNS) {
    if (pat.pattern.test(command)) {
      matches.push(pat);
    }
  }

  if (matches.length === 0) {
    return {
      category: 'unknown',
      risk: 'low',
      matchedPatterns: [],
      reason: 'No known patterns matched',
    };
  }

  // Return the highest-risk match
  matches.sort((a, b) => RISK_ORDER[b.risk] - RISK_ORDER[a.risk]);
  const highest = matches[0];

  return {
    category: highest.category,
    risk: highest.risk,
    matchedPatterns: matches.map((m) => m.name),
    reason: highest.reason,
  };
}

/**
 * Get the list of built-in pattern names for documentation/testing.
 */
export function getBuiltInPatternNames(): string[] {
  return BUILT_IN_PATTERNS.map((p) => p.name);
}
