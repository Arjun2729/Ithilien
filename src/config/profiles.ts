import type { GuardrailProfile } from '../types.js';

export const DEFAULT_PROFILE: GuardrailProfile = {
  name: 'default',
  description: 'Balanced safety for typical development work',
  filesystem: {
    readOnlyPaths: [],
    blockedPaths: ['~/.ssh', '~/.aws', '~/.gnupg', '~/.config/gh'],
    protectedFilePatterns: ['.env*', '*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa*', 'id_ed25519*'],
  },
  network: {
    mode: 'allowlist',
    allowlist: [
      'registry.npmjs.org', 'pypi.org', 'rubygems.org', 'crates.io',
      'github.com', 'api.github.com',
      'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com',
      'dl.google.com', 'storage.googleapis.com',
      'api.anthropic.com', 'api.openai.com',
    ],
  },
  resources: {
    cpuLimit: '4.0',
    memoryLimit: '8g',
    maxDuration: 3600,
  },
  git: {
    allowCommit: true,
    allowPush: false,
    allowForce: false,
  },
};

export const STRICT_PROFILE: GuardrailProfile = {
  name: 'strict',
  description: 'Maximum isolation — no network, tight resource limits',
  filesystem: {
    readOnlyPaths: [],
    blockedPaths: ['~/.ssh', '~/.aws', '~/.gnupg', '~/.config/gh', '~/.npmrc', '~/.docker'],
    protectedFilePatterns: ['.env*', '*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa*', 'id_ed25519*', '*.secret', '*.credentials'],
  },
  network: {
    mode: 'none',
    allowlist: [],
  },
  resources: {
    cpuLimit: '2.0',
    memoryLimit: '4g',
    maxDuration: 1800,
  },
  git: {
    allowCommit: true,
    allowPush: false,
    allowForce: false,
  },
};

export const PERMISSIVE_PROFILE: GuardrailProfile = {
  name: 'permissive',
  description: 'Minimal restrictions — full network, generous resources',
  filesystem: {
    readOnlyPaths: [],
    blockedPaths: ['~/.ssh', '~/.gnupg'],
    protectedFilePatterns: ['*.pem', '*.key', 'id_rsa*', 'id_ed25519*'],
  },
  network: {
    mode: 'full',
    allowlist: [],
  },
  resources: {
    cpuLimit: '8.0',
    memoryLimit: '16g',
    maxDuration: 7200,
  },
  git: {
    allowCommit: true,
    allowPush: false,
    allowForce: false,
  },
};

const BUILT_IN_PROFILES: Record<string, GuardrailProfile> = {
  default: DEFAULT_PROFILE,
  strict: STRICT_PROFILE,
  permissive: PERMISSIVE_PROFILE,
};

export function getProfile(name: string): GuardrailProfile | undefined {
  return BUILT_IN_PROFILES[name];
}

export function listProfiles(): GuardrailProfile[] {
  return Object.values(BUILT_IN_PROFILES);
}
