import type { PolicyFile } from './types.js';

/**
 * Built-in default policy.
 *
 * This policy is always active as a baseline. User-defined policies
 * can override these rules by defining rules with the same name,
 * or by setting a different defaultAction.
 *
 * Rule ordering matters: first match wins during evaluation.
 * Rules are ordered from most dangerous (deny) to least (allow).
 */
export const DEFAULT_POLICY: PolicyFile = {
  version: 1,
  description: 'Built-in default policy with dangerous command detection',
  defaultAction: 'allow',
  defaultRisk: 'low',
  commands: [
    // --- Critical: deny by default ---
    {
      name: 'pipe-to-shell',
      pattern: '\\b(curl|wget)\\b.*\\|\\s*(ba)?sh\\b',
      action: 'deny',
      risk: 'critical',
      category: 'network',
      description: 'Piping remote content to shell is extremely dangerous',
    },
    {
      name: 'disk-format',
      pattern: '\\bmkfs\\b',
      action: 'deny',
      risk: 'critical',
      category: 'system',
      description: 'Filesystem formatting',
    },
    {
      name: 'raw-device-write',
      pattern: '>\\s*/dev/sd[a-z]',
      action: 'deny',
      risk: 'critical',
      category: 'filesystem',
      description: 'Writing to raw block devices',
    },
    {
      name: 'system-shutdown',
      pattern: '\\b(shutdown|reboot|halt|poweroff)\\b',
      action: 'deny',
      risk: 'critical',
      category: 'system',
      description: 'System shutdown or reboot',
    },
    {
      name: 'git-force-push',
      pattern: '\\bgit\\s+push\\b.*(\\s--force\\b|\\s-f\\b)',
      action: 'deny',
      risk: 'critical',
      category: 'git',
      description: 'Force push can destroy remote history',
    },

    // --- High: ask before executing ---
    {
      name: 'recursive-force-delete',
      pattern: '\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\\b',
      action: 'ask',
      risk: 'high',
      category: 'filesystem',
      description: 'Recursive force delete can cause irreversible data loss',
    },
    {
      name: 'sudo',
      pattern: '\\bsudo\\b',
      action: 'ask',
      risk: 'high',
      category: 'system',
      description: 'Privilege escalation via sudo',
    },
    {
      name: 'git-push',
      pattern: '\\bgit\\s+push\\b',
      action: 'ask',
      risk: 'high',
      category: 'git',
      description: 'Pushing code to remote repository',
    },
    {
      name: 'git-hard-reset',
      pattern: '\\bgit\\s+reset\\s+--hard\\b',
      action: 'ask',
      risk: 'high',
      category: 'git',
      description: 'Hard reset destroys uncommitted changes',
    },
    {
      name: 'npm-publish',
      pattern: '\\bnpm\\s+publish\\b',
      action: 'deny',
      risk: 'high',
      category: 'package',
      description: 'Publishing packages to a registry',
    },
    {
      name: 'dd-command',
      pattern: '\\bdd\\s+',
      action: 'deny',
      risk: 'high',
      category: 'filesystem',
      description: 'Raw disk operation',
    },
    {
      name: 'eval',
      pattern: '\\beval\\b',
      action: 'ask',
      risk: 'high',
      category: 'shell',
      description: 'Dynamic shell code evaluation',
    },
    {
      name: 'chmod-world-writable',
      pattern: '\\bchmod\\s+777\\b',
      action: 'ask',
      risk: 'high',
      category: 'filesystem',
      description: 'Setting world-writable permissions',
    },

    // --- Medium: log for awareness ---
    {
      name: 'network-download',
      pattern: '\\b(curl|wget)\\b',
      action: 'log',
      risk: 'medium',
      category: 'network',
      description: 'Network download operation',
    },
    {
      name: 'chmod',
      pattern: '\\bchmod\\b',
      action: 'log',
      risk: 'medium',
      category: 'filesystem',
      description: 'Permission change',
    },
    {
      name: 'docker-command',
      pattern: '\\bdocker\\b',
      action: 'log',
      risk: 'medium',
      category: 'system',
      description: 'Docker operation from within sandbox',
    },

    // --- Low: allow, normal operations ---
    {
      name: 'npm-install',
      pattern: '\\bnpm\\s+(install|ci|add)\\b',
      action: 'allow',
      risk: 'low',
      category: 'package',
      description: 'npm package installation',
    },
    {
      name: 'git-commit',
      pattern: '\\bgit\\s+commit\\b',
      action: 'allow',
      risk: 'low',
      category: 'git',
      description: 'Git commit',
    },
    {
      name: 'git-clone',
      pattern: '\\bgit\\s+clone\\b',
      action: 'allow',
      risk: 'low',
      category: 'git',
      description: 'Repository clone',
    },
  ],
};
