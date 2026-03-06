import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveProfile, loadConfig } from '../src/config/loader.js';

describe('resolveProfile', () => {
  it('resolves built-in profiles by name', async () => {
    const profile = await resolveProfile('default');
    expect(profile.name).toBe('default');
    expect(profile.network.mode).toBe('allowlist');
    expect(profile.network.allowlist).toContain('generativelanguage.googleapis.com');
  });

  it('resolves strict profile', async () => {
    const profile = await resolveProfile('strict');
    expect(profile.name).toBe('strict');
    expect(profile.network.mode).toBe('none');
    expect(profile.git.allowPush).toBe(false);
  });

  it('resolves permissive profile', async () => {
    const profile = await resolveProfile('permissive');
    expect(profile.name).toBe('permissive');
    expect(profile.network.mode).toBe('full');
    expect(profile.git.allowCommit).toBe(true);
  });

  it('throws for unknown profile', async () => {
    await expect(resolveProfile('nonexistent')).rejects.toThrow('Unknown profile');
  });

  it('loads custom profile from project path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ithilien-config-'));
    const profileDir = join(dir, '.ithilien', 'profiles');
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, 'custom.json'), JSON.stringify({
      name: 'custom',
      description: 'Custom test profile',
      filesystem: { readOnlyPaths: [], blockedPaths: [], protectedFilePatterns: [] },
      network: { mode: 'none', allowlist: [] },
      resources: { cpuLimit: '1.0', memoryLimit: '1g', maxDuration: 60 },
      git: { allowCommit: false, allowPush: false, allowForce: false },
    }));

    try {
      const profile = await resolveProfile('custom', dir);
      expect(profile.name).toBe('custom');
      expect(profile.network.mode).toBe('none');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('loadConfig', () => {
  it('returns defaults when no config files exist', async () => {
    const config = await loadConfig('/nonexistent/path');
    expect(config.defaultProfile).toBe('default');
    expect(config.approvalServer.port).toBe(3456);
    expect(config.approvalServer.timeout).toBe(300);
  });

  it('merges project config over defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ithilien-config-'));
    const configDir = join(dir, '.ithilien');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.json'), JSON.stringify({
      defaultProfile: 'strict',
      approvalServer: { timeout: 60 },
    }));

    try {
      const config = await loadConfig(dir);
      expect(config.defaultProfile).toBe('strict');
      expect(config.approvalServer.timeout).toBe(60);
      // Port should still be default since not overridden
      expect(config.approvalServer.port).toBe(3456);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
