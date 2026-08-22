/**
 * The runtime transport for `GithubClient` (11_GITHUB.md §8, N7).
 *
 * `safeFetch` is not reusable here: it collapses every non-2xx into a rejection and drops response
 * headers, while the GitHub client needs the status (404 means "absent") and the `x-ratelimit-*`
 * headers to run its budget. So we reuse safeFetch's *primitives* instead — `validateUrl` +
 * `pinHost` — and add a hard host allowlist, which keeps the SSRF guard intact: the only URLs this
 * transport will ever open are `api.github.com` and `raw.githubusercontent.com`.
 */

import { lookup } from 'node:dns/promises';
import { pinHost, UrlRejected, validateUrl, type Resolver } from '@nexus/domain';
import type { GithubHttp, HttpResponse } from '@nexus/integrations/github/client';

/** The two hosts §8 allows; redirects away from them are refused, never followed. */
export const GITHUB_HTTP_HOSTS: readonly string[] = ['api.github.com', 'raw.githubusercontent.com'];

const MAX_BODY_BYTES = 1_048_576;

export const nodeResolver: Resolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

export interface GithubHttpOptions {
  readonly signal?: AbortSignal | undefined;
  readonly resolve?: Resolver | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly maxBytes?: number | undefined;
}

export function createGithubHttp(options: GithubHttpOptions = {}): GithubHttp {
  const resolve = options.resolve ?? nodeResolver;
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;

  return async (url, headers): Promise<HttpResponse> => {
    const { url: parsed } = validateUrl(url);
    if (!GITHUB_HTTP_HOSTS.includes(parsed.hostname))
      throw new UrlRejected(
        'address_blocked',
        'Only GitHub hosts are reachable from this transport.',
      );
    // Pins the resolved address and rejects private ranges before the socket is opened.
    await pinHost(parsed.hostname, resolve);

    const response = await fetchImpl(parsed.href, {
      method: 'GET',
      headers: { ...headers },
      redirect: 'manual',
      credentials: 'omit',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const body = await readCapped(response, maxBytes);
    return {
      status: response.status,
      headers: (name: string) => response.headers.get(name),
      body,
    };
  };
}

/** Reads at most `maxBytes`; an oversized blob is truncated, which the callers already tolerate. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const stream = response.body as ReadableStream<Uint8Array> | null;
  if (stream === null) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    size += value.byteLength;
    if (size > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (size - maxBytes)));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(joined);
}
