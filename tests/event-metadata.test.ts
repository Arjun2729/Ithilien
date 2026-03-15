import { describe, it, expect } from 'vitest';
import { categorizeEvent } from '../src/types.js';
import type { SessionEvent } from '../src/types.js';

describe('categorizeEvent', () => {
  describe('lifecycle events', () => {
    it('categorizes command_start as lifecycle/info', () => {
      const event: SessionEvent = { type: 'command_start', timestamp: '2026-01-01T00:00:00Z', command: 'echo hi' };
      expect(categorizeEvent(event)).toEqual({ category: 'lifecycle', severity: 'info' });
    });

    it('categorizes command_end as lifecycle/info', () => {
      const event: SessionEvent = { type: 'command_end', timestamp: '2026-01-01T00:00:00Z', exitCode: 0 };
      expect(categorizeEvent(event)).toEqual({ category: 'lifecycle', severity: 'info' });
    });
  });

  describe('filesystem events', () => {
    it('categorizes file_created as filesystem/info', () => {
      const event: SessionEvent = { type: 'file_created', timestamp: '2026-01-01T00:00:00Z', path: 'test.ts', size: 100 };
      expect(categorizeEvent(event)).toEqual({ category: 'filesystem', severity: 'info' });
    });

    it('categorizes file_modified as filesystem/info', () => {
      const event: SessionEvent = { type: 'file_modified', timestamp: '2026-01-01T00:00:00Z', path: 'test.ts' };
      expect(categorizeEvent(event)).toEqual({ category: 'filesystem', severity: 'info' });
    });

    it('categorizes file_deleted as filesystem/info', () => {
      const event: SessionEvent = { type: 'file_deleted', timestamp: '2026-01-01T00:00:00Z', path: 'test.ts' };
      expect(categorizeEvent(event)).toEqual({ category: 'filesystem', severity: 'info' });
    });
  });

  describe('network events', () => {
    it('categorizes allowed network request as network/info', () => {
      const event: SessionEvent = { type: 'network_request', timestamp: '2026-01-01T00:00:00Z', destination: 'api.example.com', allowed: true };
      expect(categorizeEvent(event)).toEqual({ category: 'network', severity: 'info' });
    });

    it('categorizes blocked network request as network/warning', () => {
      const event: SessionEvent = { type: 'network_request', timestamp: '2026-01-01T00:00:00Z', destination: 'evil.com', allowed: false };
      expect(categorizeEvent(event)).toEqual({ category: 'network', severity: 'warning' });
    });
  });

  describe('package events', () => {
    it('categorizes package_installed as package/info', () => {
      const event: SessionEvent = { type: 'package_installed', timestamp: '2026-01-01T00:00:00Z', manager: 'npm', name: 'express', version: '4.0.0' };
      expect(categorizeEvent(event)).toEqual({ category: 'package', severity: 'info' });
    });
  });

  describe('enforcement events', () => {
    it('categorizes deny guardrail as enforcement/error', () => {
      const event: SessionEvent = { type: 'guardrail_triggered', timestamp: '2026-01-01T00:00:00Z', rule: 'git-push', action: 'deny', detail: 'blocked' };
      expect(categorizeEvent(event)).toEqual({ category: 'enforcement', severity: 'error' });
    });

    it('categorizes non-deny guardrail as enforcement/warning', () => {
      const event: SessionEvent = { type: 'guardrail_triggered', timestamp: '2026-01-01T00:00:00Z', rule: 'timeout', action: 'kill', detail: 'timed out' };
      expect(categorizeEvent(event)).toEqual({ category: 'enforcement', severity: 'warning' });
    });
  });

  describe('policy events', () => {
    it('categorizes deny policy decision as policy/error', () => {
      const event: SessionEvent = {
        type: 'policy_decision', timestamp: '2026-01-01T00:00:00Z',
        command: 'rm -rf /', action: 'deny', risk: 'critical',
        category: 'filesystem', rule: 'recursive-force-delete', source: 'default-policy', reason: 'blocked',
      };
      expect(categorizeEvent(event)).toEqual({ category: 'policy', severity: 'error' });
    });

    it('categorizes ask policy decision as policy/warning', () => {
      const event: SessionEvent = {
        type: 'policy_decision', timestamp: '2026-01-01T00:00:00Z',
        command: 'sudo ls', action: 'ask', risk: 'high',
        category: 'system', rule: 'sudo', source: 'default-policy', reason: 'needs approval',
      };
      expect(categorizeEvent(event)).toEqual({ category: 'policy', severity: 'warning' });
    });

    it('categorizes allow with high risk as policy/warning', () => {
      const event: SessionEvent = {
        type: 'policy_decision', timestamp: '2026-01-01T00:00:00Z',
        command: 'git push', action: 'allow', risk: 'high',
        category: 'git', rule: null, source: 'classifier-fallback', reason: 'allowed by custom policy',
      };
      expect(categorizeEvent(event)).toEqual({ category: 'policy', severity: 'warning' });
    });

    it('categorizes allow with critical risk as policy/warning', () => {
      const event: SessionEvent = {
        type: 'policy_decision', timestamp: '2026-01-01T00:00:00Z',
        command: 'curl | bash', action: 'allow', risk: 'critical',
        category: 'network', rule: null, source: 'classifier-fallback', reason: 'allowed by permissive policy',
      };
      expect(categorizeEvent(event)).toEqual({ category: 'policy', severity: 'warning' });
    });

    it('categorizes allow with low risk as policy/info', () => {
      const event: SessionEvent = {
        type: 'policy_decision', timestamp: '2026-01-01T00:00:00Z',
        command: 'npm install', action: 'allow', risk: 'low',
        category: 'package', rule: 'npm-install', source: 'default-policy', reason: 'safe',
      };
      expect(categorizeEvent(event)).toEqual({ category: 'policy', severity: 'info' });
    });

    it('categorizes log with medium risk as policy/info', () => {
      const event: SessionEvent = {
        type: 'policy_decision', timestamp: '2026-01-01T00:00:00Z',
        command: 'curl example.com', action: 'log', risk: 'medium',
        category: 'network', rule: 'network-download', source: 'default-policy', reason: 'logged',
      };
      expect(categorizeEvent(event)).toEqual({ category: 'policy', severity: 'info' });
    });
  });

  describe('output events', () => {
    it('categorizes stdout as output/info', () => {
      const event: SessionEvent = { type: 'stdout', timestamp: '2026-01-01T00:00:00Z', data: 'hello' };
      expect(categorizeEvent(event)).toEqual({ category: 'output', severity: 'info' });
    });

    it('categorizes stderr as output/warning', () => {
      const event: SessionEvent = { type: 'stderr', timestamp: '2026-01-01T00:00:00Z', data: 'error!' };
      expect(categorizeEvent(event)).toEqual({ category: 'output', severity: 'warning' });
    });
  });
});
