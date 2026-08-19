/**
 * `unfurl` router (P6 §5.7, §5.8, 09_BACKEND.md §5). One page fetch, one cache entry:
 *
 *   - the key is the normalized URL, so `?utm_*` and a trailing slash do not split it;
 *   - a success lives 7 days, a failure 1 hour (a site that is down now may work tomorrow);
 *   - concurrent calls for the same key share one in-flight fetch (§7 job dedupe);
 *   - `refresh: true` bypasses the cache — that is the "Refresh" action on the card.
 *
 * There is no queue yet (`apps/worker` does not exist): the fetch runs in-request, bounded by
 * `safeFetch`'s 10 s timeout. The client never waits on it — the node is already on the board.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  UNFURL_NEGATIVE_TTL_MS,
  UNFURL_TTL_MS,
  URL_ERROR_MESSAGES,
  UrlRejected,
  parseUnfurl,
  safeFetch,
  unfurlCacheKey,
  type Resolver,
  type Transport,
  type UnfurlMetadata,
} from '@nexus/domain';
import { protectedProcedure, router } from '../trpc.ts';
import { nodeResolver, nodeTransport } from '../../net/transport.ts';

export type UnfurlResult =
  | { ok: true; cached: boolean; metadata: UnfurlMetadata }
  | { ok: false; cached: boolean; code: string; message: string };

interface Entry {
  result: UnfurlResult;
  expiresAt: number;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<UnfurlResult>>();

/** Test seam and the reason this module has no module-level clock. */
export interface UnfurlDeps {
  resolve: Resolver;
  transport: Transport;
  now: () => number;
}

const defaults: UnfurlDeps = {
  resolve: nodeResolver,
  transport: nodeTransport,
  now: () => Date.now(),
};

export const unfurlDeps: UnfurlDeps = { ...defaults };

/** Used by tests and by a deployment that swaps the transport; never by request handling. */
export function setUnfurlDeps(deps: Partial<UnfurlDeps>): void {
  Object.assign(unfurlDeps, defaults, deps);
  cache.clear();
  inFlight.clear();
}

export async function unfurl(url: string, refresh = false): Promise<UnfurlResult> {
  let key: string;
  try {
    key = unfurlCacheKey(url);
  } catch (error) {
    // A URL the policy refuses never reaches the network and is not worth caching.
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error instanceof UrlRejected ? error.message : URL_ERROR_MESSAGES.url_malformed,
    });
  }

  const now = unfurlDeps.now();
  if (!refresh) {
    const hit = cache.get(key);
    if (hit !== undefined && hit.expiresAt > now) return { ...hit.result, cached: true };
    const running = inFlight.get(key);
    if (running !== undefined) return running;
  }

  const work = fetchOnce(url).then((result) => {
    cache.set(key, {
      result,
      expiresAt: unfurlDeps.now() + (result.ok ? UNFURL_TTL_MS : UNFURL_NEGATIVE_TTL_MS),
    });
    inFlight.delete(key);
    return result;
  });
  inFlight.set(key, work);
  return work;
}

async function fetchOnce(url: string): Promise<UnfurlResult> {
  try {
    const response = await safeFetch(url, {
      resolve: unfurlDeps.resolve,
      transport: unfurlDeps.transport,
    });
    return { ok: true, cached: false, metadata: parseUnfurl(response.body, response.url) };
  } catch (error) {
    const rejection = error instanceof UrlRejected ? error : new UrlRejected('http_error');
    return { ok: false, cached: false, code: rejection.code, message: rejection.message };
  }
}

export const unfurlRouter = router({
  fetch: protectedProcedure
    .input(z.object({ url: z.string().min(1).max(2048), refresh: z.boolean().default(false) }))
    .mutation(({ input }) => unfurl(input.url, input.refresh)),
});
