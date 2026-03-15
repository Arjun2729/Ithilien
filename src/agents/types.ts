/**
 * An agent wrapper constructs a shell command from a user prompt.
 *
 * This is a thin ergonomic layer. The wrapper:
 * - Constructs a shell command string — it does NOT parse agent output
 * - Does NOT inspect or control agent behavior at runtime
 * - Relies on the agent binary being installed in the sandbox image
 * - The constructed command is subject to the same policy evaluation
 *   as any manually-typed command
 */
export interface AgentWrapper {
  /** Short machine name used in --agent flag (e.g. 'claude') */
  name: string;
  /** Human-readable display name (e.g. 'Claude Code') */
  displayName: string;
  /** One-line description of the wrapper */
  description: string;
  /** Binary name expected in $PATH inside the container */
  binary: string;
  /** Env vars the agent typically needs; user is warned if missing */
  requiredEnvVars: string[];
  /**
   * Build the full shell command from a user prompt.
   * The prompt is the raw string from the CLI positional argument.
   * Returns a complete shell command string ready for exec.
   */
  buildCommand(prompt: string): string;
}
