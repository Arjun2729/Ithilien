import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validatePolicyFile, loadPolicy } from '../src/policy/loader.js';
import { DEFAULT_POLICY } from '../src/policy/defaults.js';

describe('policy loader', () => {
  describe('validatePolicyFile', () => {
    it('accepts a valid policy', () => {
      const errors = validatePolicyFile({
        version: 1,
        defaultAction: 'allow',
        defaultRisk: 'low',
        commands: [
          {
            name: 'test-rule',
            pattern: '\\btest\\b',
            action: 'deny',
            risk: 'high',
            category: 'shell',
          },
        ],
      });
      expect(errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
      const errors = validatePolicyFile('not an object');
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('root');
    });

    it('rejects null input', () => {
      const errors = validatePolicyFile(null);
      expect(errors).toHaveLength(1);
    });

    it('rejects array input', () => {
      const errors = validatePolicyFile([]);
      expect(errors).toHaveLength(1);
    });

    it('rejects unsupported version', () => {
      const errors = validatePolicyFile({ version: 2 });
      expect(errors.some((e) => e.field === 'version')).toBe(true);
    });

    it('accepts missing optional fields', () => {
      const errors = validatePolicyFile({});
      expect(errors).toHaveLength(0);
    });

    it('rejects invalid defaultAction', () => {
      const errors = validatePolicyFile({ defaultAction: 'block' });
      expect(errors.some((e) => e.field === 'defaultAction')).toBe(true);
    });

    it('rejects invalid defaultRisk', () => {
      const errors = validatePolicyFile({ defaultRisk: 'extreme' });
      expect(errors.some((e) => e.field === 'defaultRisk')).toBe(true);
    });

    it('rejects non-array commands', () => {
      const errors = validatePolicyFile({ commands: 'not-array' });
      expect(errors.some((e) => e.field === 'commands')).toBe(true);
    });

    it('validates each command rule', () => {
      const errors = validatePolicyFile({
        commands: [
          { name: '', pattern: '', action: 'invalid', risk: 'invalid', category: 'invalid' },
        ],
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field.includes('name'))).toBe(true);
      expect(errors.some((e) => e.field.includes('action'))).toBe(true);
      expect(errors.some((e) => e.field.includes('risk'))).toBe(true);
      expect(errors.some((e) => e.field.includes('category'))).toBe(true);
    });

    it('rejects invalid regex patterns', () => {
      const errors = validatePolicyFile({
        commands: [
          { name: 'bad-regex', pattern: '[invalid', action: 'deny', risk: 'high', category: 'shell' },
        ],
      });
      expect(errors.some((e) => e.field.includes('pattern'))).toBe(true);
    });

    it('accepts valid regex patterns', () => {
      const errors = validatePolicyFile({
        commands: [
          { name: 'good-regex', pattern: '\\brm\\s+-rf\\b', action: 'deny', risk: 'high', category: 'filesystem' },
        ],
      });
      expect(errors).toHaveLength(0);
    });
  });

  describe('loadPolicy', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `ithilien-test-policy-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('returns default policy when no files exist', async () => {
      const { policy, warnings } = await loadPolicy({ projectPath: tempDir });
      expect(policy.version).toBe(1);
      expect(policy.defaultAction).toBe('allow');
      expect(policy.commands.length).toBeGreaterThan(0);
      expect(warnings).toHaveLength(0);
    });

    it('loads project-level policy and prepends rules', async () => {
      const policyDir = join(tempDir, '.ithilien');
      await mkdir(policyDir, { recursive: true });
      await writeFile(
        join(policyDir, 'policy.json'),
        JSON.stringify({
          version: 1,
          commands: [
            {
              name: 'custom-rule',
              pattern: '\\bcustom\\b',
              action: 'deny',
              risk: 'high',
              category: 'shell',
            },
          ],
        }),
      );

      const { policy } = await loadPolicy({ projectPath: tempDir });
      // Custom rule should be first (prepended)
      expect(policy.commands[0].name).toBe('custom-rule');
      // Default rules should still be present
      expect(policy.commands.length).toBeGreaterThan(1);
    });

    it('overrides defaultAction from project policy', async () => {
      const policyDir = join(tempDir, '.ithilien');
      await mkdir(policyDir, { recursive: true });
      await writeFile(
        join(policyDir, 'policy.json'),
        JSON.stringify({
          version: 1,
          defaultAction: 'deny',
          commands: [],
        }),
      );

      const { policy } = await loadPolicy({ projectPath: tempDir });
      expect(policy.defaultAction).toBe('deny');
    });

    it('throws on invalid JSON', async () => {
      const policyDir = join(tempDir, '.ithilien');
      await mkdir(policyDir, { recursive: true });
      await writeFile(join(policyDir, 'policy.json'), 'not json');

      await expect(loadPolicy({ projectPath: tempDir })).rejects.toThrow('Invalid JSON');
    });

    it('throws on invalid policy structure', async () => {
      const policyDir = join(tempDir, '.ithilien');
      await mkdir(policyDir, { recursive: true });
      await writeFile(
        join(policyDir, 'policy.json'),
        JSON.stringify({
          version: 99,
          commands: [{ name: '', pattern: '[bad', action: 'nope', risk: 'nope', category: 'nope' }],
        }),
      );

      await expect(loadPolicy({ projectPath: tempDir })).rejects.toThrow('Invalid policy file');
    });

    describe('source tagging', () => {
      it('tags default policy rules with default-policy source', async () => {
        const { policy } = await loadPolicy({ projectPath: tempDir });
        for (const rule of policy.commands) {
          expect(rule.source).toBe('default-policy');
        }
      });

      it('tags project-level rules with project-policy source', async () => {
        const policyDir = join(tempDir, '.ithilien');
        await mkdir(policyDir, { recursive: true });
        await writeFile(
          join(policyDir, 'policy.json'),
          JSON.stringify({
            version: 1,
            commands: [
              { name: 'proj-rule', pattern: '\\bproj\\b', action: 'deny', risk: 'high', category: 'shell' },
            ],
          }),
        );

        const { policy } = await loadPolicy({ projectPath: tempDir });
        expect(policy.commands[0].name).toBe('proj-rule');
        expect(policy.commands[0].source).toBe('project-policy');
      });

      it('tags explicit --policy rules with cli-override source', async () => {
        const policyFile = join(tempDir, 'custom-policy.json');
        await writeFile(
          policyFile,
          JSON.stringify({
            version: 1,
            commands: [
              { name: 'cli-rule', pattern: '\\bcli\\b', action: 'deny', risk: 'high', category: 'shell' },
            ],
          }),
        );

        const { policy } = await loadPolicy({ policyPath: policyFile });
        expect(policy.commands[0].name).toBe('cli-rule');
        expect(policy.commands[0].source).toBe('cli-override');
      });
    });

    describe('explicit --policy path', () => {
      it('loads policy from explicit path', async () => {
        const policyFile = join(tempDir, 'my-policy.json');
        await writeFile(
          policyFile,
          JSON.stringify({
            version: 1,
            defaultAction: 'deny',
            commands: [
              { name: 'explicit-rule', pattern: '\\bexplicit\\b', action: 'allow', risk: 'low', category: 'shell' },
            ],
          }),
        );

        const { policy } = await loadPolicy({ policyPath: policyFile });
        expect(policy.defaultAction).toBe('deny');
        expect(policy.commands[0].name).toBe('explicit-rule');
      });

      it('throws if explicit policy path does not exist', async () => {
        await expect(
          loadPolicy({ policyPath: join(tempDir, 'nonexistent.json') }),
        ).rejects.toThrow('Policy file not found');
      });

      it('explicit policy overrides project policy discovery', async () => {
        // Create a project-level policy
        const policyDir = join(tempDir, '.ithilien');
        await mkdir(policyDir, { recursive: true });
        await writeFile(
          join(policyDir, 'policy.json'),
          JSON.stringify({
            version: 1,
            commands: [
              { name: 'project-rule', pattern: '\\bproject\\b', action: 'deny', risk: 'high', category: 'shell' },
            ],
          }),
        );

        // Create an explicit policy
        const explicitFile = join(tempDir, 'override.json');
        await writeFile(
          explicitFile,
          JSON.stringify({
            version: 1,
            commands: [
              { name: 'override-rule', pattern: '\\boverride\\b', action: 'allow', risk: 'low', category: 'shell' },
            ],
          }),
        );

        const { policy } = await loadPolicy({ projectPath: tempDir, policyPath: explicitFile });
        const ruleNames = policy.commands.map((r) => r.name);
        // Override rule should be present
        expect(ruleNames).toContain('override-rule');
        // Project rule should NOT be present (explicit overrides project discovery)
        expect(ruleNames).not.toContain('project-rule');
      });
    });

    describe('unsupported rule warnings', () => {
      it('warns when paths rules are present', async () => {
        const policyDir = join(tempDir, '.ithilien');
        await mkdir(policyDir, { recursive: true });
        await writeFile(
          join(policyDir, 'policy.json'),
          JSON.stringify({
            version: 1,
            commands: [],
            paths: [
              { pattern: '/etc/**', action: 'deny' },
            ],
          }),
        );

        const { warnings } = await loadPolicy({ projectPath: tempDir });
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings[0].message).toContain('path rule');
        expect(warnings[0].message).toContain('not enforced yet');
      });

      it('warns when network rules are present', async () => {
        const policyDir = join(tempDir, '.ithilien');
        await mkdir(policyDir, { recursive: true });
        await writeFile(
          join(policyDir, 'policy.json'),
          JSON.stringify({
            version: 1,
            commands: [],
            network: [
              { pattern: '*.evil.com', action: 'deny' },
            ],
          }),
        );

        const { warnings } = await loadPolicy({ projectPath: tempDir });
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings[0].message).toContain('network rule');
        expect(warnings[0].message).toContain('not enforced yet');
      });

      it('does not warn when no unsupported rules are present', async () => {
        const policyDir = join(tempDir, '.ithilien');
        await mkdir(policyDir, { recursive: true });
        await writeFile(
          join(policyDir, 'policy.json'),
          JSON.stringify({
            version: 1,
            commands: [
              { name: 'safe-rule', pattern: '\\bls\\b', action: 'allow', risk: 'low', category: 'filesystem' },
            ],
          }),
        );

        const { warnings } = await loadPolicy({ projectPath: tempDir });
        expect(warnings).toHaveLength(0);
      });
    });
  });

  describe('default policy integrity', () => {
    it('has version 1', () => {
      expect(DEFAULT_POLICY.version).toBe(1);
    });

    it('has allow as defaultAction', () => {
      expect(DEFAULT_POLICY.defaultAction).toBe('allow');
    });

    it('has rules for common dangerous patterns', () => {
      const names = DEFAULT_POLICY.commands.map((r) => r.name);
      expect(names).toContain('pipe-to-shell');
      expect(names).toContain('recursive-force-delete');
      expect(names).toContain('sudo');
      expect(names).toContain('git-push');
      expect(names).toContain('git-force-push');
    });

    it('all rules have valid regex patterns', () => {
      for (const rule of DEFAULT_POLICY.commands) {
        expect(() => new RegExp(rule.pattern)).not.toThrow();
      }
    });
  });
});
