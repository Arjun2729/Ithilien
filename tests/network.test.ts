import { describe, it, expect, vi } from 'vitest';
import { buildNetworkConfig } from '../src/sandbox/network.js';
import { getProfile } from '../src/config/profiles.js';
import type { GuardrailProfile } from '../src/types.js';

vi.mock('node:dns/promises', () => {
  return {
    resolve: vi.fn(async (domain: string) => {
      switch (domain) {
        case 'dns.google':
          return ['8.8.8.8', '8.8.4.4'];
        case 'example.com':
          return ['93.184.216.34'];
        default:
          throw new Error('ENOTFOUND');
      }
    }),
  };
});

// Mock Docker instance (buildNetworkConfig only uses it for type, not calls)
const mockDocker = {} as any;

function profileWithNetwork(mode: 'none' | 'allowlist' | 'full', allowlist: string[] = []): GuardrailProfile {
  const base = getProfile('default')!;
  return { ...base, network: { mode, allowlist } };
}

describe('buildNetworkConfig', () => {
  it('returns disabled network for mode=none', async () => {
    const config = await buildNetworkConfig(mockDocker, profileWithNetwork('none'));
    expect(config.networkMode).toBe('none');
    expect(config.networkName).toBeNull();
    expect(config.dnsServers).toHaveLength(0);
    expect(config.extraHosts).toHaveLength(0);
  });

  it('returns bridge for mode=full', async () => {
    const config = await buildNetworkConfig(mockDocker, profileWithNetwork('full'));
    expect(config.networkMode).toBe('bridge');
    expect(config.networkName).toBeNull();
    expect(config.dnsServers).toHaveLength(0);
  });

  it('creates named network for mode=allowlist', async () => {
    const config = await buildNetworkConfig(
      mockDocker,
      profileWithNetwork('allowlist', ['example.com'])
    );
    expect(config.networkMode).toMatch(/^ithilien-net-/);
    expect(config.networkName).toMatch(/^ithilien-net-/);
    // DNS pointed at localhost to black-hole unresolved domains
    expect(config.dnsServers).toEqual(['127.0.0.1']);
  });

  it('resolves allowed domains to --add-host entries', async () => {
    // Use a domain that should reliably resolve
    const config = await buildNetworkConfig(
      mockDocker,
      profileWithNetwork('allowlist', ['dns.google'])
    );
    // dns.google should resolve to 8.8.8.8 and/or 8.8.4.4
    expect(config.extraHosts.length).toBeGreaterThan(0);
    expect(config.extraHosts[0]).toMatch(/^dns\.google:\d+\.\d+\.\d+\.\d+$/);
  });

  it('silently skips unresolvable domains', async () => {
    const config = await buildNetworkConfig(
      mockDocker,
      profileWithNetwork('allowlist', ['this-domain-definitely-does-not-exist-12345.invalid'])
    );
    expect(config.extraHosts).toHaveLength(0);
    // But still sets up the network and DNS blackhole
    expect(config.dnsServers).toEqual(['127.0.0.1']);
  });
});
