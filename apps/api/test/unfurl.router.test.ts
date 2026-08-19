/**
 * P6 §5.7/§5.8 — unfurl fetch, cache, negative cache and in-flight dedupe. No network: the
 * transport and the resolver are injected, which is the same seam the SSRF corpus uses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '@nexus/domain';
import { ctx, prismaMock, recordAuditMock } from './prisma-mock.ts';

vi.mock('@nexus/db', () => ({ prisma: prismaMock, recordAudit: recordAuditMock }));

const { appRouter } = await import('../src/trpc/router.ts');
const { createCallerFactory } = await import('../src/trpc/trpc.ts');
const { setUnfurlDeps } = await import('../src/trpc/routers/unfurl.ts');

const caller = createCallerFactory(appRouter);

const page = `<html><head><title>Example</title>
  <meta name="description" content="A page"></head></html>`;

const okTransport = (calls: { n: number }): Transport => {
  return async () => {
    calls.n += 1;
    return {
      status: 200,
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      body: async function* () {
        yield new TextEncoder().encode(page);
      },
    };
  };
};

let clock = 1_000;
let calls = { n: 0 };

beforeEach(() => {
  clock = 1_000;
  calls = { n: 0 };
  setUnfurlDeps({
    resolve: async () => ['93.184.216.34'],
    transport: okTransport(calls),
    now: () => clock,
  });
});

describe('unfurl.fetch', () => {
  it('fetches a page and returns sanitized metadata', async () => {
    const result = await caller(ctx()).unfurl.fetch({
      url: 'https://example.com/a',
      refresh: false,
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.cached).toBe(false);
    expect(result.metadata.title).toBe('Example');
    expect(result.metadata.description).toBe('A page');
    expect(result.metadata.favicon).toBe('https://example.com/favicon.ico');
  });

  it('serves the second call from cache, across URL spellings', async () => {
    await caller(ctx()).unfurl.fetch({ url: 'https://example.com/a', refresh: false });
    const second = await caller(ctx()).unfurl.fetch({
      url: 'https://example.com/a/?utm_source=x',
      refresh: false,
    });
    expect(second.cached).toBe(true);
    expect(calls.n).toBe(1);
  });

  it('refetches after the 7 day TTL and when Refresh bypasses the cache', async () => {
    await caller(ctx()).unfurl.fetch({ url: 'https://example.com/a', refresh: false });
    await caller(ctx()).unfurl.fetch({ url: 'https://example.com/a', refresh: true });
    expect(calls.n).toBe(2);

    clock += 8 * 24 * 60 * 60 * 1000;
    await caller(ctx()).unfurl.fetch({ url: 'https://example.com/a', refresh: false });
    expect(calls.n).toBe(3);
  });

  it('collapses concurrent fetches of the same URL into one job', async () => {
    const [a, b] = await Promise.all([
      caller(ctx()).unfurl.fetch({ url: 'https://example.com/a', refresh: false }),
      caller(ctx()).unfurl.fetch({ url: 'https://example.com/a', refresh: false }),
    ]);
    expect(calls.n).toBe(1);
    expect(a.ok && b.ok).toBe(true);
  });

  it('returns a reason code for a blocked address and negative-caches it for an hour', async () => {
    setUnfurlDeps({
      resolve: async () => ['127.0.0.1'],
      transport: okTransport(calls),
      now: () => clock,
    });
    const result = await caller(ctx()).unfurl.fetch({
      url: 'https://internal.example/',
      refresh: false,
    });
    expect(result).toMatchObject({ ok: false, code: 'address_blocked' });
    if (result.ok) throw new Error('expected a rejection');
    expect(result.message).toContain('private network');

    clock += 30 * 60 * 1000;
    const cached = await caller(ctx()).unfurl.fetch({
      url: 'https://internal.example/',
      refresh: false,
    });
    expect(cached.cached).toBe(true);

    clock += 40 * 60 * 1000;
    const retried = await caller(ctx()).unfurl.fetch({
      url: 'https://internal.example/',
      refresh: false,
    });
    expect(retried.cached).toBe(false);
  });

  it('reports a failing transport as a fetch error rather than crashing', async () => {
    setUnfurlDeps({
      resolve: async () => ['93.184.216.34'],
      transport: async () => {
        throw new Error('ECONNRESET');
      },
      now: () => clock,
    });
    const result = await caller(ctx()).unfurl.fetch({
      url: 'https://example.com/',
      refresh: false,
    });
    expect(result).toMatchObject({ ok: false, code: 'http_error' });
  });

  it('rejects a policy-refused URL at the boundary, without fetching', async () => {
    await expect(
      caller(ctx()).unfurl.fetch({ url: 'file:///etc/passwd', refresh: false }),
    ).rejects.toThrow(/http and https/);
    expect(calls.n).toBe(0);
  });

  it('requires a session', async () => {
    await expect(
      caller(ctx({ user: null })).unfurl.fetch({ url: 'https://example.com/', refresh: false }),
    ).rejects.toThrow(/session/i);
  });
});
