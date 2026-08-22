import { describe, expect, it } from 'vitest';
import { createGithubHttp } from '../src/net/github-http.ts';

const resolve = async (): Promise<string[]> => ['140.82.121.4'];

function fetchStub(body: string, status = 200, headers: Record<string, string> = {}): typeof fetch {
  return (async () => new Response(body, { status, headers })) as unknown as typeof fetch;
}

describe('createGithubHttp', () => {
  it('returns status, headers and body for an allowed host', async () => {
    const http = createGithubHttp({
      resolve,
      fetchImpl: fetchStub('{"ok":true}', 200, { 'x-ratelimit-remaining': '58' }),
    });
    const response = await http('https://api.github.com/repos/a/b', {});
    expect(response.status).toBe(200);
    expect(response.body).toBe('{"ok":true}');
    expect(response.headers('x-ratelimit-remaining')).toBe('58');
  });

  it('passes non-2xx through instead of throwing, so 404 can mean "absent"', async () => {
    const http = createGithubHttp({ resolve, fetchImpl: fetchStub('not found', 404) });
    await expect(http('https://api.github.com/repos/a/b', {})).resolves.toMatchObject({
      status: 404,
    });
  });

  it('refuses any host outside the GitHub allowlist', async () => {
    const http = createGithubHttp({ resolve, fetchImpl: fetchStub('x') });
    await expect(http('https://evil.example.com/', {})).rejects.toThrow(/private network/i);
  });

  it('refuses a malformed url before resolving anything', async () => {
    const http = createGithubHttp({ resolve, fetchImpl: fetchStub('x') });
    await expect(http('not-a-url', {})).rejects.toThrow();
  });

  it('truncates a body larger than the cap', async () => {
    const http = createGithubHttp({
      resolve,
      maxBytes: 4,
      fetchImpl: fetchStub('abcdefghij'),
    });
    const response = await http('https://raw.githubusercontent.com/a/b/c/d', {});
    expect(response.body).toBe('abcd');
  });
});
