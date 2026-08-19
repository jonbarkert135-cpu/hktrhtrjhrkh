/**
 * Address policy + DNS pinning (15_SECURITY.md §4, N7). Resolution happens once; the resolved IP is
 * what gets connected to, so a name that answers "8.8.8.8" now and "127.0.0.1" a millisecond later
 * (DNS rebinding) cannot move the request onto the internal network.
 *
 * The resolver is injected: `packages/domain` must stay runtime-free, and the tests need a hostile
 * corpus without touching the network.
 */

import { UrlRejected } from './urlValidator.ts';

export type Resolver = (hostname: string) => Promise<readonly string[]>;

const v4 = (address: string): number[] | null => {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
};

/** True for loopback, private, link-local, CGNAT, unique-local, multicast and reserved space. */
export function isBlockedAddress(address: string): boolean {
  const plain = address.replace(/^\[|]$/g, '').split('%')[0] ?? '';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(plain);
  if (mapped?.[1] !== undefined) return isBlockedAddress(mapped[1]);

  const octets = v4(plain);
  if (octets !== null) {
    const [a = 0, b = 0] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  const ipv6 = plain.toLowerCase();
  if (!ipv6.includes(':')) return false; // not an address literal; the caller resolves names
  if (ipv6 === '::' || ipv6 === '::1') return true;
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(ipv6);
}

export interface PinnedHost {
  readonly hostname: string;
  /** The one address the connection must use — no re-resolution downstream. */
  readonly address: string;
}

/**
 * Resolves `hostname` and returns the single address to connect to. Every returned address must be
 * public: a name that resolves to one public and one private address is refused outright, because
 * which one is used would otherwise be a race.
 */
export async function pinHost(hostname: string, resolve: Resolver): Promise<PinnedHost> {
  if (isBlockedAddress(hostname)) throw new UrlRejected('address_blocked');

  let addresses: readonly string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new UrlRejected('dns_failed');
  }
  if (addresses.length === 0) throw new UrlRejected('dns_failed');
  if (addresses.some(isBlockedAddress)) throw new UrlRejected('address_blocked');

  return { hostname, address: addresses[0] as string };
}
