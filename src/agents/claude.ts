import type { AgentWrapper } from './types.js';

/**
 * Shell-escape a string for embedding in single quotes.
 *
 * Strategy: wrap in single quotes, escaping any internal single quotes
 * by ending the quoted string, adding an escaped single quote, and
 * restarting the quoted string: ' -> '\''
 *
 * This is the standard POSIX shell single-quote escape pattern.
 * Inside single quotes, all characters are literal — no expansion
 * of $, backtick, \, or any other metacharacter.
 */
export function shellEscape(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

/**
 * System prompt injected when --reasoning-sidecar is active.
 * Instructs Claude Code to write structured reasoning events to the sidecar file
 * before each file operation, upgrading reasoning extraction from heuristic
 * stdout parsing to structured, high-confidence data.
 */
export const SIDECAR_SYSTEM_PROMPT =
  'Before each file operation (creating, modifying, or deleting a file), ' +
  'append a JSON line to /tmp/ithilien-reasoning.jsonl with this exact schema:\n' +
  '{"type":"reasoning","content":"your detailed reasoning","intent":"what you are trying to accomplish","timestamp":"<ISO 8601>"}\n' +
  'The file is mounted in your container environment. Write one JSON line per reasoning event. ' +
  'Do not write anything else to that file.';

/**
 * Inject a --system-prompt flag into a Claude Code command string.
 *
 * Only modifies commands that invoke the `claude` binary.
 * If the command already has a --system-prompt flag, it is not modified
 * (the agent-provided system prompt is preserved).
 *
 * Inserts the flag immediately before -p / --print so argument ordering
 * remains predictable.
 */
export function injectSidecarSystemPrompt(command: string): string {
  if (!/\bclaude\b/.test(command)) return command;
  if (/--system-prompt[= ]/.test(command)) return command;

  const escaped = shellEscape(SIDECAR_SYSTEM_PROMPT);
  const flag = `--system-prompt ${escaped}`;

  // Insert before -p or --print (handles both short and long forms)
  if (/ -p | --print /.test(command)) {
    return command.replace(/( -p | --print )/, ` ${flag}$1`);
  }

  // Fallback: append the flag at the end of the command
  return `${command} ${flag}`;
}

export const claudeWrapper: AgentWrapper = {
  name: 'claude',
  displayName: 'Claude Code',
  description: 'Anthropic Claude Code CLI (claude --dangerously-skip-permissions)',
  binary: 'claude',
  requiredEnvVars: ['ANTHROPIC_API_KEY'],

  buildCommand(prompt: string): string {
    return `claude --dangerously-skip-permissions -p ${shellEscape(prompt)}`;
  },
};
