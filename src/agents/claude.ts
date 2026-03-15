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
