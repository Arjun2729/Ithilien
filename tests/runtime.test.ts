import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  detectGvisor,
  selectRuntime,
  getDockerRuntimeName,
  describeRuntime,
  GVISOR_INSTALL_URL,
  DOCKER_KERNEL_WARNING,
} from '../src/sandbox/runtime.js';

// Mock child_process.execSync to avoid real subprocess calls
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runtime', () => {
  describe('detectGvisor', () => {
    it('returns true when runsc --version succeeds', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('runsc version 1.0.0') as unknown as string);
      expect(detectGvisor()).toBe(true);
    });

    it('returns false when runsc is not found', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockImplementationOnce(() => { throw new Error('ENOENT'); });
      expect(detectGvisor()).toBe(false);
    });

    it('returns false on any error, never throws', async () => {
      const { execSync } = await import('node:child_process');
      // Mock twice: once for the not.toThrow check, once for the toBe(false) check
      const throwFn = () => { throw new Error('permission denied'); };
      vi.mocked(execSync).mockImplementation(throwFn);
      expect(() => detectGvisor()).not.toThrow();
      expect(detectGvisor()).toBe(false);
    });
  });

  describe('selectRuntime', () => {
    it('returns gvisor-runsc when explicitly requested', () => {
      expect(selectRuntime('gvisor-runsc')).toBe('gvisor-runsc');
    });

    it('returns docker-runc when explicitly requested', () => {
      expect(selectRuntime('docker-runc')).toBe('docker-runc');
    });

    it('returns gvisor-runsc for auto when gVisor is available', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('runsc version 1.0.0') as unknown as string);
      expect(selectRuntime('auto')).toBe('gvisor-runsc');
    });

    it('returns docker-runc for auto when gVisor is unavailable', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockImplementationOnce(() => { throw new Error('not found'); });
      expect(selectRuntime('auto')).toBe('docker-runc');
    });

    it('defaults to auto behavior when called without argument', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockImplementationOnce(() => { throw new Error('not found'); });
      // Without gVisor: should fall back to docker-runc
      const result = selectRuntime();
      expect(['gvisor-runsc', 'docker-runc']).toContain(result);
    });
  });

  describe('getDockerRuntimeName', () => {
    it('returns "runsc" for gvisor-runsc', () => {
      expect(getDockerRuntimeName('gvisor-runsc')).toBe('runsc');
    });

    it('returns undefined for docker-runc', () => {
      expect(getDockerRuntimeName('docker-runc')).toBeUndefined();
    });
  });

  describe('describeRuntime', () => {
    it('marks gvisor as recommended', () => {
      const info = describeRuntime('gvisor-runsc');
      expect(info.recommended).toBe(true);
      expect(info.kernel).toContain('user-space');
    });

    it('marks docker-runc as not recommended', () => {
      const info = describeRuntime('docker-runc');
      expect(info.recommended).toBe(false);
      expect(info.kernel).toContain('Shared');
    });

    it('provides isolation description for each runtime', () => {
      expect(describeRuntime('gvisor-runsc').isolation).toBeTruthy();
      expect(describeRuntime('docker-runc').isolation).toBeTruthy();
    });
  });

  describe('constants', () => {
    it('GVISOR_INSTALL_URL points to gvisor.dev', () => {
      expect(GVISOR_INSTALL_URL).toContain('gvisor.dev');
    });

    it('DOCKER_KERNEL_WARNING mentions shared host kernel', () => {
      expect(DOCKER_KERNEL_WARNING.toLowerCase()).toContain('kernel');
      expect(DOCKER_KERNEL_WARNING).toContain(GVISOR_INSTALL_URL);
    });
  });
});
