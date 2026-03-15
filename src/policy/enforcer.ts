import { createInterface } from 'node:readline';
import type { PolicyDecision } from './types.js';

/**
 * Result of enforcing a policy decision.
 */
export interface EnforcementResult {
  /** Whether execution should proceed */
  proceed: boolean;
  /** The original decision */
  decision: PolicyDecision;
  /** How the decision was resolved (for 'ask' actions) */
  resolution?: 'approved' | 'denied-by-user' | 'denied-non-interactive';
}

/**
 * Enforce a policy decision.
 *
 * - allow: proceed
 * - log: proceed (logging is handled by the caller)
 * - deny: block with explanation
 * - ask: prompt interactively if TTY, fail closed otherwise
 *
 * This function handles the interactive ask flow. The caller is
 * responsible for emitting audit events and printing messages.
 */
export async function enforceDecision(decision: PolicyDecision): Promise<EnforcementResult> {
  switch (decision.action) {
    case 'allow':
    case 'log':
      return { proceed: true, decision };

    case 'deny':
      return { proceed: false, decision };

    case 'ask':
      return await handleAsk(decision);
  }
}

/**
 * Handle an 'ask' decision by prompting the user interactively.
 *
 * If stdin is a TTY, shows the command details and prompts for
 * confirmation. If stdin is not a TTY (e.g. CI, piped input),
 * fails closed (denies).
 */
async function handleAsk(decision: PolicyDecision): Promise<EnforcementResult> {
  if (!process.stdin.isTTY) {
    return {
      proceed: false,
      decision,
      resolution: 'denied-non-interactive',
    };
  }

  const approved = await promptConfirmation(decision);

  return {
    proceed: approved,
    decision,
    resolution: approved ? 'approved' : 'denied-by-user',
  };
}

/**
 * Prompt the user for confirmation in the terminal.
 * Returns true if approved, false if denied.
 */
async function promptConfirmation(decision: PolicyDecision): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise<boolean>((resolve) => {
    rl.question('  Approve? [y/N] ', (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Format a policy decision as a user-facing message.
 * Used for both deny and ask actions.
 */
export function formatDecisionMessage(decision: PolicyDecision): string {
  const lines: string[] = [];

  const riskLabel = decision.risk.toUpperCase();
  const actionLabel = decision.action.toUpperCase();

  lines.push(`  Policy ${actionLabel}: ${decision.reason}`);
  lines.push(`  Risk: ${riskLabel} | Category: ${decision.category}`);

  if (decision.matchedRule) {
    lines.push(`  Rule: ${decision.matchedRule} (${decision.source})`);
  } else {
    lines.push(`  Source: ${decision.source}`);
  }

  return lines.join('\n');
}
