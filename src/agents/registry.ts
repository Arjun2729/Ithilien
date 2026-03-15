import type { AgentWrapper } from './types.js';
import { claudeWrapper } from './claude.js';

/** All registered agent wrappers, keyed by name. */
const AGENTS: Map<string, AgentWrapper> = new Map([
  [claudeWrapper.name, claudeWrapper],
]);

/**
 * Look up an agent wrapper by name.
 * Returns undefined if no wrapper is registered for the given name.
 */
export function getAgent(name: string): AgentWrapper | undefined {
  return AGENTS.get(name);
}

/**
 * List all registered agent wrappers.
 * Returns a new array (caller cannot mutate the registry).
 */
export function listAgents(): AgentWrapper[] {
  return [...AGENTS.values()];
}

/**
 * Get all registered agent names.
 * Useful for CLI help text and validation.
 */
export function getAgentNames(): string[] {
  return [...AGENTS.keys()];
}
