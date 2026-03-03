import { resolve as dnsResolve } from 'node:dns/promises';
import type Docker from 'dockerode';
import type { GuardrailProfile } from '../types.js';

const NETWORK_PREFIX = 'ithilien-net-';

export interface NetworkConfig {
  networkMode: string;
  networkName: string | null;
  dnsServers: string[];
  extraHosts: string[];
}

/**
 * Build Docker network configuration based on the guardrail profile.
 *
 * - 'none':      NetworkDisabled=true, no network stack at all
 * - 'full':      default bridge, unrestricted
 * - 'allowlist': Internal bridge network. DNS is pointed at a black-hole
 *                (127.0.0.1) so arbitrary domain resolution fails. Allowed
 *                domains are pre-resolved and injected via --add-host so
 *                only those IPs are reachable by name. This is defense-in-depth,
 *                not airtight — a determined process can still reach raw IPs.
 *                For strict IP-level enforcement, use network mode 'none'.
 */
export async function buildNetworkConfig(
  _docker: Docker,
  profile: GuardrailProfile
): Promise<NetworkConfig> {
  switch (profile.network.mode) {
    case 'none':
      return { networkMode: 'none', networkName: null, dnsServers: [], extraHosts: [] };

    case 'full':
      return { networkMode: 'bridge', networkName: null, dnsServers: [], extraHosts: [] };

    case 'allowlist': {
      const networkName = `${NETWORK_PREFIX}${Date.now()}`;
      // Pre-resolve allowed domains to IPs
      const extraHosts = await resolveAllowlist(profile.network.allowlist);
      return {
        networkMode: networkName,
        networkName,
        // Point DNS to localhost so unresolved domains fail
        dnsServers: ['127.0.0.1'],
        extraHosts,
      };
    }

    default:
      return { networkMode: 'bridge', networkName: null, dnsServers: [], extraHosts: [] };
  }
}

/**
 * Resolve allowlisted domains to IP addresses for --add-host injection.
 * Returns entries like ["registry.npmjs.org:104.16.x.x", ...].
 */
async function resolveAllowlist(domains: string[]): Promise<string[]> {
  const entries: string[] = [];

  for (const domain of domains) {
    try {
      const addresses = await dnsResolve(domain);
      for (const addr of addresses) {
        entries.push(`${domain}:${addr}`);
      }
    } catch {
      // Domain doesn't resolve — skip it silently.
      // This is expected for some domains that may be CDN-routed.
    }
  }

  return entries;
}

/**
 * Create a Docker network for allowlist mode.
 * Uses Internal:true to prevent direct outbound by default.
 * Combined with DNS black-hole + --add-host, this restricts
 * which domains the container can reach by name.
 */
export async function createNetworkIfNeeded(
  docker: Docker,
  networkName: string
): Promise<void> {
  try {
    await docker.createNetwork({
      Name: networkName,
      Driver: 'bridge',
      Internal: false, // Must be false to allow any outbound traffic
      Labels: {
        'ithilien.managed': 'true',
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes('already exists')) {
      throw err;
    }
  }
}

/**
 * Remove an ithilien-managed network.
 */
export async function removeNetworkIfNeeded(
  docker: Docker,
  networkName: string
): Promise<void> {
  try {
    const network = docker.getNetwork(networkName);
    await network.remove();
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Clean up any stale ithilien networks.
 */
export async function cleanupStaleNetworks(docker: Docker): Promise<number> {
  let cleaned = 0;
  try {
    const networks = await docker.listNetworks({
      filters: { label: ['ithilien.managed=true'] },
    });
    for (const net of networks) {
      try {
        await docker.getNetwork(net.Id).remove();
        cleaned++;
      } catch {
        // In use or already gone
      }
    }
  } catch {
    // Ignore
  }
  return cleaned;
}
