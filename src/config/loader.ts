import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import type { IthilienConfig, GuardrailProfile } from '../types.js';
import { getProfile, DEFAULT_PROFILE } from './profiles.js';

const GLOBAL_CONFIG_PATH = join(homedir(), '.ithilien', 'config.json');
const PROJECT_CONFIG_DIR = '.ithilien';

const DEFAULT_CONFIG: IthilienConfig = {
  defaultProfile: 'default',
  sessionsDir: join(homedir(), '.ithilien', 'sessions'),
  approvalServer: {
    port: 3456,
    timeout: 300,
  },
};

/**
 * Load config by merging: defaults < global < project-level.
 */
export async function loadConfig(projectPath?: string): Promise<IthilienConfig> {
  let config = { ...DEFAULT_CONFIG };

  // Global config
  const globalConfig = await loadJsonFile<Partial<IthilienConfig>>(GLOBAL_CONFIG_PATH);
  if (globalConfig) {
    config = mergeConfig(config, globalConfig);
  }

  // Project config
  if (projectPath) {
    const projectConfigPath = join(projectPath, PROJECT_CONFIG_DIR, 'config.json');
    const projectConfig = await loadJsonFile<Partial<IthilienConfig>>(projectConfigPath);
    if (projectConfig) {
      config = mergeConfig(config, projectConfig);
    }
  }

  return config;
}

/**
 * Resolve a guardrail profile by name.
 * Checks: built-in profiles -> project custom profiles -> global custom profiles.
 */
export async function resolveProfile(
  name: string,
  projectPath?: string
): Promise<GuardrailProfile> {
  // Check built-in profiles first
  const builtIn = getProfile(name);
  if (builtIn) return builtIn;

  // Check project-level custom profiles
  if (projectPath) {
    const profilePath = join(projectPath, PROJECT_CONFIG_DIR, 'profiles', `${name}.json`);
    const custom = await loadJsonFile<GuardrailProfile>(profilePath);
    if (custom) return custom;
  }

  // Check global custom profiles
  const globalProfilePath = join(homedir(), '.ithilien', 'profiles', `${name}.json`);
  const globalCustom = await loadJsonFile<GuardrailProfile>(globalProfilePath);
  if (globalCustom) return globalCustom;

  throw new Error(
    `Unknown profile: "${name}". Available built-in profiles: default, strict, permissive.\n` +
    `Custom profiles can be placed in .ithilien/profiles/${name}.json`
  );
}

async function loadJsonFile<T>(path: string): Promise<T | null> {
  try {
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function mergeConfig(base: IthilienConfig, override: Partial<IthilienConfig>): IthilienConfig {
  return {
    ...base,
    ...override,
    approvalServer: {
      ...base.approvalServer,
      ...(override.approvalServer ?? {}),
    },
  };
}
