/**
 * The runtime half of `safeFetch` (P6 §5.9): resolution and the single `fetch` call. The policy is
 * tested in `@nexus/domain`; what matters here is that the request carries no redirect following
 * and no credentials, and that the body arrives as chunks the caller can cap.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup }));

const { nodeResolver, nodeTransport } = await import('../src/net/transport.ts');

const collect = async (body: AsyncIterable<Uint8Array>): Promise<string> => {
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of body) text += decoder.decode(chunk);
  return text;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nodeResolver', () => {
  it('returns every address the name resolves to', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34' }, { address: '2606:4700::1111' }]);
    await expect(nodeResolver('example.com')).resolves.toEqual([
      '93.184.216.34',
      '2606:4700::1111',
    ]);
    expect(lookup).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
  });
});

describe('nodeTransport', () => {
  const request = {
    url: new URL('https://example.com/'),
    pinned: { hostname: 'example.com', address: '93.184.216.34' },
    headers: { accept: 'text/html' },
    signal: new AbortController().signal,
  };

  it('never follows a redirect itself and never sends credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await nodeTransport(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(await collect(response.body())).toBe('<html></html>');

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options.redirect).toBe('manual');
    expect(options.credentials).toBe('omit');
  });

  it('yields nothing when the response has no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 304, headers: new Headers(), body: null }),
    );
    const response = await nodeTransport(request);
    expect(await collect(response.body())).toBe('');
  });
});
