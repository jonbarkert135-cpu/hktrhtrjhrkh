/**
 * The builtin module registry (10_INTEGRATIONS.md §3.3).
 *
 * `builtin` executions run in the runner process — no container — but only for modules listed
 * here. Third parties cannot contribute one (17_PLUGIN_SDK.md §5.3): the whole point of the
 * sandbox is that unknown code never runs in our process.
 */

import { REDIRECT_LIMIT, safeFetch, type Resolver, type Transport } from '@nexus/domain';
import { IntegrationError } from '@nexus/integrations';

export interface BuiltinContext {
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly transport: Transport;
  readonly resolve: Resolver;
  readonly now: () => string;
  readonly log: (message: string) => void;
}

export interface BuiltinModule {
  readonly name: string;
  /** Returns the primary artifact body; the executor caps, hashes and uploads it. */
  run(input: Record<string, unknown>, ctx: BuiltinContext): Promise<string>;
}

/**
 * `expand-url`: follows redirects on a pasted link through `safeFetch` (P6), which enforces the
 * scheme allowlist, DNS pinning, the redirect cap and the body cap for us. The output is the
 * document `builtin/parser.ts` expects.
 */
export const expandUrlModule: BuiltinModule = {
  name: 'expand-url',

  async run(input, ctx) {
    const url = typeof input.url === 'string' ? input.url : '';
    if (url === '') {
      throw new IntegrationError('INPUT_INVALID', { why: 'No URL was provided to expand.' });
    }
    const chain: string[] = [url];
    let result;
    try {
      result = await safeFetch(url, {
        resolve: ctx.resolve,
        transport: ctx.transport,
        redirectLimit: REDIRECT_LIMIT,
        signal: ctx.signal,
        // The destination is a page; we only need enough of it to know we arrived.
        maxBytes: 64 * 1024,
      });
    } catch (error) {
      throw new IntegrationError('UPSTREAM_UNAVAILABLE', {
        why:
          error instanceof Error ? error.message.slice(0, 140) : 'The destination did not answer.',
      });
    }
    if (result.url !== url) chain.push(result.url);
    ctx.log(`expanded to ${result.url}`);

    return JSON.stringify({
      version: '1.0',
      inputUrl: url,
      finalUrl: result.url,
      hops: chain.length - 1,
      status: result.status,
      chain,
      observedAt: ctx.now(),
    });
  },
};

export const BUILTIN_MODULES: ReadonlyMap<string, BuiltinModule> = new Map([
  [expandUrlModule.name, expandUrlModule],
]);

export function requireBuiltin(name: string): BuiltinModule {
  const module = BUILTIN_MODULES.get(name);
  if (module === undefined) {
    throw new IntegrationError('MANIFEST_INVALID', {
      why: `No builtin module named "${name}" is registered in this build.`,
      detail: { module: name },
    });
  }
  return module;
}
