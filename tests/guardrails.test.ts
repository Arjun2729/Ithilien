import { describe, it, expect } from 'vitest';
import { buildResourceConfig } from '../src/sandbox/guardrails.js';
import { isProtectedFile } from '../src/sandbox/mounts.js';
import { getProfile, listProfiles } from '../src/config/profiles.js';

describe('buildResourceConfig', () => {
  it('converts memory string to bytes', () => {
    const profile = getProfile('default')!;
    const config = buildResourceConfig(profile);
    expect(config.memory).toBe(8 * 1024 ** 3); // 8g
  });

  it('converts CPU string to nanoCPUs', () => {
    const profile = getProfile('default')!;
    const config = buildResourceConfig(profile);
    expect(config.nanoCpus).toBe(4 * 1e9); // 4.0 CPUs
  });

  it('handles strict profile limits', () => {
    const profile = getProfile('strict')!;
    const config = buildResourceConfig(profile);
    expect(config.memory).toBe(4 * 1024 ** 3);
    expect(config.nanoCpus).toBe(2 * 1e9);
  });
});

describe('isProtectedFile', () => {
  const patterns = ['.env*', '*.pem', '*.key', 'id_rsa*', 'id_ed25519*'];

  it('matches .env files', () => {
    expect(isProtectedFile('.env', patterns)).toBe(true);
    expect(isProtectedFile('.env.local', patterns)).toBe(true);
    expect(isProtectedFile('.env.production', patterns)).toBe(true);
  });

  it('matches key files', () => {
    expect(isProtectedFile('server.pem', patterns)).toBe(true);
    expect(isProtectedFile('private.key', patterns)).toBe(true);
    expect(isProtectedFile('id_rsa', patterns)).toBe(true);
    expect(isProtectedFile('id_ed25519', patterns)).toBe(true);
  });

  it('does not match safe files', () => {
    expect(isProtectedFile('index.ts', patterns)).toBe(false);
    expect(isProtectedFile('package.json', patterns)).toBe(false);
    expect(isProtectedFile('README.md', patterns)).toBe(false);
  });
});

describe('profiles', () => {
  it('has three built-in profiles', () => {
    expect(listProfiles()).toHaveLength(3);
  });

  it('default profile allows commit but not push', () => {
    const p = getProfile('default')!;
    expect(p.git.allowCommit).toBe(true);
    expect(p.git.allowPush).toBe(false);
    expect(p.git.allowForce).toBe(false);
  });

  it('strict profile disables network', () => {
    const p = getProfile('strict')!;
    expect(p.network.mode).toBe('none');
  });

  it('permissive profile allows full network', () => {
    const p = getProfile('permissive')!;
    expect(p.network.mode).toBe('full');
  });
});
