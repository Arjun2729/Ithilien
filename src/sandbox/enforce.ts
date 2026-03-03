import type { GuardrailProfile } from '../types.js';

/**
 * Generate a shell wrapper script that enforces guardrail policies inside the container.
 * This script is prepended to the user's command and:
 * 1. Intercepts `git push` / `git push --force` if disallowed
 * 2. Enforces network allowlist at the IP level via iptables
 * 3. Sets up post-execution check for protected files
 *
 * For git policies, we replace `git` with a wrapper function that
 * inspects subcommands before passing through.
 */
export function buildEnforcementPreamble(profile: GuardrailProfile): string {
  const lines: string[] = [
    '# Ithilien guardrail enforcement',
  ];

  // Git policy enforcement via shell function override
  if (!profile.git.allowPush || !profile.git.allowForce) {
    lines.push('__ithilien_real_git=$(which git)');
    lines.push('git() {');
    lines.push('  local subcmd="${1:-}"');

    if (!profile.git.allowPush) {
      lines.push('  if [ "$subcmd" = "push" ]; then');
      lines.push('    echo "GUARDRAIL: git push is blocked by the $ITHILIEN_PROFILE profile." >&2');
      lines.push('    return 1');
      lines.push('  fi');
    }

    if (!profile.git.allowForce) {
      lines.push('  for arg in "$@"; do');
      lines.push('    case "$arg" in');
      lines.push('      --force|-f|--force-with-lease)');
      lines.push('        echo "GUARDRAIL: git --force is blocked by the $ITHILIEN_PROFILE profile." >&2');
      lines.push('        return 1');
      lines.push('        ;;');
      lines.push('    esac');
      lines.push('  done');
    }

    if (!profile.git.allowCommit) {
      lines.push('  if [ "$subcmd" = "commit" ]; then');
      lines.push('    echo "GUARDRAIL: git commit is blocked by the $ITHILIEN_PROFILE profile." >&2');
      lines.push('    return 1');
      lines.push('  fi');
    }

    lines.push('  "$__ithilien_real_git" "$@"');
    lines.push('}');
    lines.push('export -f git');
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generate a post-execution check script that verifies protected file patterns
 * weren't modified. Returns a script that should run after the main command.
 */
export function buildProtectedFileCheck(profile: GuardrailProfile): string {
  if (profile.filesystem.protectedFilePatterns.length === 0) {
    return '';
  }

  const patterns = profile.filesystem.protectedFilePatterns
    .map((p) => `"${p}"`)
    .join(' ');

  return `
# Ithilien: check for protected file modifications
__ithilien_check_protected() {
  local patterns=(${patterns})
  local violations=0
  for pattern in "\${patterns[@]}"; do
    while IFS= read -r -d '' file; do
      if git diff --name-only HEAD 2>/dev/null | grep -q "$(basename "$file")" 2>/dev/null; then
        echo "GUARDRAIL: Protected file modified: $file" >&2
        violations=$((violations + 1))
      fi
    done < <(find /workspace -name "$pattern" -print0 2>/dev/null)
  done
  if [ $violations -gt 0 ]; then
    echo "GUARDRAIL: $violations protected file(s) were modified." >&2
  fi
}
`;
}

/**
 * Build iptables rules that restrict outbound traffic to only the resolved
 * allowlist IPs. Requires CAP_NET_ADMIN on the container.
 * The $ITHILIEN_ALLOWED_IPS env var is a comma-separated list of IPs.
 */
export function buildIptablesEnforcement(): string {
  return `
# Ithilien: enforce network allowlist at IP level
if [ -n "$ITHILIEN_ALLOWED_IPS" ] && command -v iptables >/dev/null 2>&1; then
  # Default: drop all outbound
  iptables -P OUTPUT DROP 2>/dev/null
  # Allow loopback
  iptables -A OUTPUT -o lo -j ACCEPT 2>/dev/null
  # Allow established/related connections (for DNS responses, etc.)
  iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null
  # Allow each allowlisted IP
  IFS=',' read -ra __ith_ips <<< "$ITHILIEN_ALLOWED_IPS"
  for __ith_ip in "\${__ith_ips[@]}"; do
    iptables -A OUTPUT -d "$__ith_ip" -j ACCEPT 2>/dev/null
  done
  unset __ith_ips __ith_ip
fi
`;
}

/**
 * Wrap a command with guardrail enforcement.
 * Prepends git/push restrictions, appends protected-file check.
 */
export function wrapCommand(command: string, profile: GuardrailProfile): string {
  const parts: string[] = [];

  parts.push(buildEnforcementPreamble(profile));

  // Network allowlist enforcement via iptables (if applicable)
  if (profile.network.mode === 'allowlist') {
    parts.push(buildIptablesEnforcement());
  }

  const protectedCheck = buildProtectedFileCheck(profile);
  if (protectedCheck) {
    // Define the check function, run the command,
    // capture its exit code, run the check, then exit with the original code.
    parts.push(protectedCheck);
    parts.push(`__ithilien_cmd_exit=0`);
    parts.push(`( ${command} )`);
    parts.push(`__ithilien_cmd_exit=$?`);
    parts.push(`__ithilien_check_protected`);
    parts.push(`exit $__ithilien_cmd_exit`);
  } else {
    parts.push(command);
  }

  return parts.join('\n');
}
