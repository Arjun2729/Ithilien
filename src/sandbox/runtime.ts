/**
 * Container runtime abstraction.
 *
 * Ithilien supports two container runtimes:
 *
 * - docker-runc  (default) — standard Linux namespaces + cgroups.
 *   Process isolation, shared host kernel.
 *   Stops accidents; does not protect against an adversarial agent that
 *   exploits a kernel vulnerability.
 *
 * - gvisor-runsc — gVisor intercepts syscalls in a user-space kernel (Sentry).
 *   The sandboxed process never reaches the host kernel directly.
 *   Dramatically reduces the kernel attack surface. Recommended for any
 *   compliance use case or when running untrusted agent commands.
 *   Not equivalent to a microVM (Firecracker/Kata) — shared ptrace surface
 *   remains — but it is the right default for most teams.
 *
 * Honest limitation: gVisor is not equivalent to a microVM.
 * For maximum isolation on sensitive workloads, Firecracker or Kata Containers
 * are stronger. gVisor is the right default for most teams.
 *
 * Install gVisor: https://gvisor.dev/docs/user_guide/install/
 */

import { execSync } from 'node:child_process';

export type SandboxRuntime = 'docker-runc' | 'gvisor-runsc';
export type RuntimePreference = SandboxRuntime | 'auto';

export const GVISOR_INSTALL_URL = 'https://gvisor.dev/docs/user_guide/install/';

export const DOCKER_KERNEL_WARNING =
  'Docker (runc) provides process isolation but shares the host kernel. ' +
  'Install gVisor for stronger syscall-level isolation: ' +
  GVISOR_INSTALL_URL;

/**
 * Check whether gVisor (runsc) is installed and appears functional.
 * Returns false on any error — never throws.
 */
export function detectGvisor(): boolean {
  try {
    execSync('runsc --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Select a runtime based on explicit preference or auto-detection.
 *
 * auto: uses gVisor if available, falls back to Docker.
 */
export function selectRuntime(preference: RuntimePreference = 'auto'): SandboxRuntime {
  if (preference === 'gvisor-runsc') return 'gvisor-runsc';
  if (preference === 'docker-runc') return 'docker-runc';
  return detectGvisor() ? 'gvisor-runsc' : 'docker-runc';
}

/**
 * Map a SandboxRuntime to the Docker API `Runtime` field.
 * Returns undefined for the default runc (Docker uses runc when unset).
 */
export function getDockerRuntimeName(runtime: SandboxRuntime): string | undefined {
  return runtime === 'gvisor-runsc' ? 'runsc' : undefined;
}

/**
 * Human-readable description of a runtime's isolation properties.
 */
export function describeRuntime(runtime: SandboxRuntime): {
  name: string;
  isolation: string;
  kernel: string;
  recommended: boolean;
} {
  if (runtime === 'gvisor-runsc') {
    return {
      name: 'gVisor (runsc)',
      isolation: 'Syscall interception',
      kernel: 'Separate (user-space)',
      recommended: true,
    };
  }
  return {
    name: 'Docker (runc)',
    isolation: 'Process/namespace',
    kernel: 'Shared host',
    recommended: false,
  };
}
