/**
 * DNS pinning and the address denylist (15_SECURITY.md §4). Rebinding is the case that matters:
 * the address that was validated must be the address that is connected to.
 */

import { describe, expect, it } from 'vitest';

import { isBlockedAddress, pinHost } from '../src/net/dnsPin.ts';
import { UrlRejected } from '../src/net/urlValidator.ts';

const BLOCKED = [
  '127.0.0.1',
  '127.9.9.9',
  '0.0.0.0',
  '10.0.0.5',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.1.1',
  '169.254.169.254', // cloud metadata
  '100.64.0.1', // CGNAT
  '192.0.0.1',
  '224.0.0.1',
  '255.255.255.255',
  '::1',
  '::',
  'fd00::1',
  'fe80::1',
  '::ffff:127.0.0.1',
];

const ALLOWED = ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111'];

describe('isBlockedAddress', () => {
  for (const address of BLOCKED) {
    it(`blocks ${address}`, () => expect(isBlockedAddress(address)).toBe(true));
  }
  for (const address of ALLOWED) {
    it(`allows ${address}`, () => expect(isBlockedAddress(address)).toBe(false));
  }
  it('does not treat a host name as an address', () => {
    expect(isBlockedAddress('example.com')).toBe(false);
  });
});

const code = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UrlRejected) return error.code;
    throw error;
  }
  throw new Error('expected a rejection');
};

describe('pinHost', () => {
  it('returns the first resolved address as the pin', async () => {
    const pinned = await pinHost('example.com', async () => ['93.184.216.34', '93.184.216.35']);
    expect(pinned).toEqual({ hostname: 'example.com', address: '93.184.216.34' });
  });

  it('refuses a literal private host without resolving', async () => {
    expect(
      await code(
        pinHost('127.0.0.1', async () => {
          throw new Error('must not resolve');
        }),
      ),
    ).toBe('address_blocked');
  });

  it('refuses a rebinding answer that mixes a public and a private address', async () => {
    expect(await code(pinHost('rebind.example', async () => ['93.184.216.34', '127.0.0.1']))).toBe(
      'address_blocked',
    );
  });

  it('reports an empty or failing resolution as dns_failed', async () => {
    expect(await code(pinHost('nx.example', async () => []))).toBe('dns_failed');
    expect(
      await code(
        pinHost('nx.example', async () => {
          throw new Error('ENOTFOUND');
        }),
      ),
    ).toBe('dns_failed');
  });
});
