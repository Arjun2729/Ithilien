import { describe, it, expect } from 'vitest';
import { buildEnforcementPreamble, buildProtectedFileCheck, buildIptablesEnforcement, wrapCommand } from '../src/sandbox/enforce.js';
import { getProfile } from '../src/config/profiles.js';
import type { GuardrailProfile } from '../src/types.js';

describe('buildEnforcementPreamble', () => {
  it('blocks git push when allowPush is false', () => {
    const profile = getProfile('default')!;
    const preamble = buildEnforcementPreamble(profile);
    expect(preamble).toContain('git()');
    expect(preamble).toContain('"push"');
    expect(preamble).toContain('GUARDRAIL: git push is blocked');
    expect(preamble).toContain('return 1');
  });

  it('blocks git --force when allowForce is false', () => {
    const profile = getProfile('default')!;
    const preamble = buildEnforcementPreamble(profile);
    expect(preamble).toContain('--force|-f|--force-with-lease');
    expect(preamble).toContain('GUARDRAIL: git --force is blocked');
  });

  it('blocks git commit when allowCommit is false', () => {
    const profile: GuardrailProfile = {
      ...getProfile('strict')!,
      git: { allowCommit: false, allowPush: false, allowForce: false },
    };
    const preamble = buildEnforcementPreamble(profile);
    expect(preamble).toContain('"commit"');
    expect(preamble).toContain('GUARDRAIL: git commit is blocked');
  });

  it('does not create git wrapper when all git ops allowed', () => {
    const profile: GuardrailProfile = {
      ...getProfile('permissive')!,
      git: { allowCommit: true, allowPush: true, allowForce: true },
    };
    const preamble = buildEnforcementPreamble(profile);
    expect(preamble).not.toContain('git()');
    expect(preamble).not.toContain('GUARDRAIL');
  });

  it('saves real git path before overriding', () => {
    const profile = getProfile('default')!;
    const preamble = buildEnforcementPreamble(profile);
    expect(preamble).toContain('__ithilien_real_git=$(which git)');
    expect(preamble).toContain('"$__ithilien_real_git" "$@"');
    expect(preamble).toContain('export -f git');
  });
});

describe('buildProtectedFileCheck', () => {
  it('returns empty string when no protected patterns', () => {
    const profile = { ...getProfile('permissive')! };
    profile.filesystem = { ...profile.filesystem, protectedFilePatterns: [] };
    const check = buildProtectedFileCheck(profile);
    expect(check).toBe('');
  });

  it('generates check script for protected patterns', () => {
    const profile = getProfile('default')!;
    const check = buildProtectedFileCheck(profile);
    expect(check).toContain('__ithilien_check_protected');
    expect(check).toContain('GUARDRAIL: Protected file modified');
    expect(check).toContain('.env');
  });
});

describe('buildIptablesEnforcement', () => {
  it('generates iptables rules using ITHILIEN_ALLOWED_IPS env var', () => {
    const script = buildIptablesEnforcement();
    expect(script).toContain('ITHILIEN_ALLOWED_IPS');
    expect(script).toContain('iptables -P OUTPUT DROP');
    expect(script).toContain('iptables -A OUTPUT -o lo -j ACCEPT');
    expect(script).toContain('iptables -A OUTPUT -d "$__ith_ip" -j ACCEPT');
  });
});

describe('wrapCommand', () => {
  it('prepends enforcement preamble to command', () => {
    const profile = getProfile('default')!;
    const wrapped = wrapCommand('npm test', profile);
    expect(wrapped).toContain('# Ithilien guardrail enforcement');
    expect(wrapped).toContain('npm test');
    const preambleIdx = wrapped.indexOf('# Ithilien guardrail enforcement');
    const cmdIdx = wrapped.indexOf('npm test');
    expect(preambleIdx).toBeLessThan(cmdIdx);
  });

  it('includes iptables enforcement for allowlist profiles', () => {
    const profile = getProfile('default')!; // default uses allowlist
    const wrapped = wrapCommand('npm test', profile);
    expect(wrapped).toContain('iptables -P OUTPUT DROP');
    expect(wrapped).toContain('ITHILIEN_ALLOWED_IPS');
  });

  it('does not include iptables for non-allowlist profiles', () => {
    const profile = getProfile('strict')!; // strict uses none
    const wrapped = wrapCommand('npm test', profile);
    expect(wrapped).not.toContain('iptables');
  });

  it('includes protected file check after command', () => {
    const profile = getProfile('default')!;
    const wrapped = wrapCommand('npm test', profile);
    // Protected file check is defined and called
    expect(wrapped).toContain('__ithilien_check_protected');
    expect(wrapped).toContain('__ithilien_cmd_exit');
    // Command runs inside a subshell
    expect(wrapped).toContain('( npm test )');
  });

  it('does not include protected file check when no patterns', () => {
    const profile: GuardrailProfile = {
      ...getProfile('strict')!,
      filesystem: { ...getProfile('strict')!.filesystem, protectedFilePatterns: [] },
    };
    const wrapped = wrapCommand('npm test', profile);
    expect(wrapped).not.toContain('__ithilien_check_protected');
    expect(wrapped).toContain('npm test');
  });
});
