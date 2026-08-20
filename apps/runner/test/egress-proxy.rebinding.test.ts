/**
 * §13 point 5 — the DNS-rebinding corpus, shared with N7's hostile URL corpus.
 *
 * The property being tested is narrow and important: the proxy decides on the *resolved addresses*,
 * not on the name, and it rejects an answer set where any record is private. A rebinding attack
 * returns one public and one private record and relies on the client picking the second.
 */

import { describe, expect, it } from 'vitest';

import {
  authorize,
  EgressPolicyStore,
  hostMatches,
  hashPath,
  MAX_REDIRECT_HOPS,
} from '../src/sandbox/egress-proxy.ts';

const NOW = Date.parse('2026-02-01T00:00:00.000Z');

function storeWith(
  overrides: Partial<Parameters<EgressPolicyStore['register']>[0]> = {},
): EgressPolicyStore {
  const store = new EgressPolicyStore();
  store.register({
    runId: 'run-1',
    mode: 'broad',
    allow: [],
    maxRequestsPerMinute: 60,
    expiresAt: NOW + 60_000,
    ...overrides,
  });
  return store;
}

const resolveTo =
  (...addresses: string[]) =>
  () =>
    Promise.resolve(addresses);

/** Hostile answers seen in the wild plus the ones N7's corpus names. */
const REBINDING_CORPUS: readonly { name: string; addresses: string[] }[] = [
  { name: 'link-local metadata', addresses: ['169.254.169.254'] },
  { name: 'loopback', addresses: ['127.0.0.1'] },
  { name: 'rfc1918 /8', addresses: ['10.1.2.3'] },
  { name: 'rfc1918 /12', addresses: ['172.20.0.5'] },
  { name: 'rfc1918 /16', addresses: ['192.168.1.1'] },
  { name: 'ipv6 loopback', addresses: ['::1'] },
  { name: 'ipv6 unique-local', addresses: ['fd00::1'] },
  { name: 'ipv6 link-local', addresses: ['fe80::1'] },
  {
    name: 'public first, private second (classic rebind)',
    addresses: ['93.184.216.34', '127.0.0.1'],
  },
  { name: 'private first, public second', addresses: ['10.0.0.1', '93.184.216.34'] },
  { name: 'multicast', addresses: ['239.1.1.1'] },
  { name: 'this-network', addresses: ['0.0.0.0'] },
];

describe('egress proxy DNS pinning (§6.4 point 4)', () => {
  it('refuses every answer set containing a private or reserved address', async () => {
    for (const entry of REBINDING_CORPUS) {
      const result = await authorize(
        storeWith(),
        { token: 'run-1', host: 'rebind.test', port: 443, now: NOW },
        resolveTo(...entry.addresses),
      );
      expect(result.decision.allowed, entry.name).toBe(false);
      if (!result.decision.allowed) expect(result.decision.reason).toBe('private-address');
    }
  });

  it('allows a public host and returns the pinned address to dial', async () => {
    const result = await authorize(
      storeWith(),
      { token: 'run-1', host: 'example.test', port: 443, now: NOW },
      resolveTo('93.184.216.34'),
    );
    expect(result.decision.allowed).toBe(true);
    expect(result.address).toBe('93.184.216.34');
  });

  it('refuses an unknown or expired run token before it resolves anything', async () => {
    let resolved = false;
    const spy = () => {
      resolved = true;
      return Promise.resolve(['93.184.216.34']);
    };
    const unknown = await authorize(
      storeWith(),
      { token: 'nope', host: 'example.test', port: 443, now: NOW },
      spy,
    );
    expect(unknown.decision).toMatchObject({ allowed: false, reason: 'unknown-token' });

    const expired = await authorize(
      storeWith({ expiresAt: NOW - 1 }),
      { token: 'run-1', host: 'example.test', port: 443, now: NOW },
      spy,
    );
    expect(expired.decision).toMatchObject({ allowed: false, reason: 'token-expired' });
    expect(resolved).toBe(false);
  });

  it('enforces the allowlist, including wildcards, and mode: none', async () => {
    const allowlisted = storeWith({ mode: 'allowlist', allow: ['api.example.test', '*.cdn.test'] });
    await expect(
      authorize(
        allowlisted,
        { token: 'run-1', host: 'evil.test', port: 443, now: NOW },
        resolveTo('93.184.216.34'),
      ),
    ).resolves.toMatchObject({ decision: { allowed: false, reason: 'host-not-allowed' } });
    await expect(
      authorize(
        allowlisted,
        { token: 'run-1', host: 'a.cdn.test', port: 443, now: NOW },
        resolveTo('93.184.216.34'),
      ),
    ).resolves.toMatchObject({ decision: { allowed: true } });

    const offline = storeWith({ mode: 'none' });
    await expect(
      authorize(
        offline,
        { token: 'run-1', host: 'example.test', port: 443, now: NOW },
        resolveTo('93.184.216.34'),
      ),
    ).resolves.toMatchObject({ decision: { allowed: false, reason: 'network-disabled' } });

    expect(hostMatches('cdn.test', '*.cdn.test')).toBe(false);
    expect(hostMatches('a.cdn.test', '*.cdn.test')).toBe(true);
  });

  it('rate-limits per run with a 20% burst and caps redirect hops', async () => {
    const store = storeWith({ maxRequestsPerMinute: 2 });
    const attempt = () =>
      authorize(
        store,
        { token: 'run-1', host: 'example.test', port: 443, now: NOW },
        resolveTo('93.184.216.34'),
      );
    expect((await attempt()).decision.allowed).toBe(true);
    expect((await attempt()).decision.allowed).toBe(true);
    // 2/minute plus a burst of 1 → the fourth request in the same instant is refused.
    await attempt();
    expect((await attempt()).decision).toMatchObject({ allowed: false, reason: 'rate-limited' });

    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1)
      expect(store.countRedirect('run-1')).toBe(true);
    expect(store.countRedirect('run-1')).toBe(false);
  });

  it('logs hosts in clear and paths only as a hash (§6.4 point 7)', () => {
    expect(hashPath('/secret?token=abc')).toMatch(/^[a-f0-9]{8}$/);
    expect(hashPath('/secret?token=abc')).not.toContain('token');
  });

  it('forgets a run policy once it is revoked', async () => {
    const store = storeWith();
    store.revoke('run-1');
    await expect(
      authorize(
        store,
        { token: 'run-1', host: 'example.test', port: 443, now: NOW },
        resolveTo('93.184.216.34'),
      ),
    ).resolves.toMatchObject({ decision: { allowed: false, reason: 'unknown-token' } });
  });
});
