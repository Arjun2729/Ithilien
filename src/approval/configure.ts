import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Writes (or merges) Claude Code hooks config into ~/.claude/settings.json.
 * Adds a PreToolUse HTTP hook pointing at the local approval server.
 */
export async function writeHooksConfig(hookUrl: string, timeout: number): Promise<void> {
  const claudeDir = join(homedir(), '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  await mkdir(claudeDir, { recursive: true });

  let settings: Record<string, unknown> = {};
  try {
    const raw = await readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh
  }

  // Build the hook entry
  const ithilienHook = {
    type: 'http' as const,
    url: hookUrl,
    timeout,
  };

  // Merge into existing hooks
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const preToolUse = (hooks.PreToolUse ?? []) as Array<{
    matcher?: string;
    hooks: Array<{ type: string; url?: string }>;
  }>;

  // Check if we already have an Ithilien hook entry
  const existing = preToolUse.find((entry) =>
    entry.hooks?.some((h) => h.type === 'http' && h.url?.includes('/api/claude-approval'))
  );

  if (existing) {
    // Update existing entry
    existing.hooks = existing.hooks.map((h) =>
      h.type === 'http' && h.url?.includes('/api/claude-approval')
        ? ithilienHook
        : h
    );
  } else {
    // Add new entry
    preToolUse.push({
      matcher: 'Bash|Edit|Write',
      hooks: [ithilienHook],
    });
  }

  hooks.PreToolUse = preToolUse;
  settings.hooks = hooks;

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/**
 * Removes Ithilien hooks from Claude Code settings.
 */
export async function removeHooksConfig(): Promise<void> {
  const settingsPath = join(homedir(), '.claude', 'settings.json');

  let settings: Record<string, unknown>;
  try {
    const raw = await readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    return; // Nothing to remove
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const preToolUse = (hooks.PreToolUse ?? []) as Array<{
    hooks: Array<{ type: string; url?: string }>;
  }>;

  hooks.PreToolUse = preToolUse.filter(
    (entry) => !entry.hooks?.some((h) => h.type === 'http' && h.url?.includes('/api/claude-approval'))
  );

  if ((hooks.PreToolUse as unknown[]).length === 0) {
    delete hooks.PreToolUse;
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooks;
  }

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
