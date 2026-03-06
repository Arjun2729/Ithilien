import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { GuardrailProfile } from '../types.js';

/**
 * Build Docker bind mount configuration based on the guardrail profile.
 * The workspace volume is always mounted at /workspace.
 * Blocked paths are excluded entirely.
 * Read-only paths are mounted with :ro.
 */
export function buildMountConfig(profile: GuardrailProfile, workspaceVolume: string): string[] {
  const mounts: string[] = [];

  // Workspace volume (the isolated copy of the project)
  mounts.push(`${workspaceVolume}:/workspace`);

  // Read-only paths
  for (const p of profile.filesystem.readOnlyPaths) {
    const resolved = resolveHomePath(p);
    mounts.push(`${resolved}:${resolved}:ro`);
  }

  // Note: blockedPaths are simply never mounted, so they're
  // completely invisible inside the container. No action needed.

  // Auto-mount agent auth directories (read-write so tokens can refresh)
  const home = homedir();
  const agentAuthDirs = [
    { host: join(home, '.gemini'), container: '/home/sandbox/.gemini' },
    { host: join(home, '.config', 'gemini'), container: '/home/sandbox/.config/gemini' },
  ];
  for (const { host, container } of agentAuthDirs) {
    if (existsSync(host)) {
      mounts.push(`${host}:${container}`);
    }
  }

  return mounts;
}

/**
 * Resolve ~ to the actual home directory.
 */
function resolveHomePath(p: string): string {
  if (p.startsWith('~')) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

/**
 * Check if a file path matches any of the protected patterns.
 * Used to validate that protected files aren't being modified.
 */
export function isProtectedFile(filePath: string, patterns: string[]): boolean {
  const fileName = filePath.split('/').pop() ?? '';

  for (const pattern of patterns) {
    if (matchGlob(fileName, pattern)) return true;
    if (matchGlob(filePath, pattern)) return true;
  }

  return false;
}

/**
 * Simple glob matching (supports * and ? wildcards).
 */
function matchGlob(str: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$'
  );
  return regex.test(str);
}
