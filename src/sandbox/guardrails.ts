import type { GuardrailProfile } from '../types.js';

export interface ResourceConfig {
  memory: number;   // bytes
  nanoCpus: number; // 1 CPU = 1e9 nanoCPUs
}

/**
 * Convert profile resource limits into Docker-native values.
 */
export function buildResourceConfig(profile: GuardrailProfile): ResourceConfig {
  return {
    memory: parseMemory(profile.resources.memoryLimit),
    nanoCpus: parseCpu(profile.resources.cpuLimit),
  };
}

/**
 * Parse a memory string like "4g", "512m", "1024k" into bytes.
 */
function parseMemory(mem: string): number {
  const match = mem.match(/^(\d+(?:\.\d+)?)\s*(k|m|g|t)?b?$/i);
  if (!match) {
    throw new Error(`Invalid memory limit: "${mem}". Use e.g. "4g", "512m".`);
  }
  const value = parseFloat(match[1]);
  const unit = (match[2] ?? '').toLowerCase();

  const multipliers: Record<string, number> = {
    '': 1,
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    t: 1024 ** 4,
  };

  return Math.floor(value * (multipliers[unit] ?? 1));
}

/**
 * Parse a CPU limit string like "2.0" into nanoCPUs.
 */
function parseCpu(cpu: string): number {
  const value = parseFloat(cpu);
  if (isNaN(value) || value <= 0) {
    throw new Error(`Invalid CPU limit: "${cpu}". Use e.g. "2.0".`);
  }
  return Math.floor(value * 1e9);
}
