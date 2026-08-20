/**
 * The builtin execution path end-to-end inside the runner: manifest → executor → artifact, with
 * the same timeout and cancellation contract a container run gets (§3.3).
 */

import { describe, expect, it } from 'vitest';
import type { Transport } from '@nexus/domain';
import { manifest as expandUrl } from '@nexus/integrations/builtin/expand-url';
import { effectiveLimits, networkPolicyOf } from '@nexus/integrations';

import { createBuiltinExecutor } from '../src/executors/builtin.ts';
import { requireBuiltin } from '../src/executors/builtin-registry.ts';
import type { CancelWatch } from '../src/cancel.ts';

const limits = effectiveLimits(expandUrl.execution.limits, networkPolicyOf(expandUrl));

function transportReturning(status: number, location?: string): Transport {
  return () =>
    Promise.resolve({
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'location'
            ? (location ?? null)
            : name.toLowerCase() === 'content-type'
              ? 'text/html'
              : null,
      },
      body: async function* () {
        yield new TextEncoder().encode('<html><title>Landing</title></html>');
      },
    });
}

const sink = () => {
  const written: { key: string; body: string }[] = [];
  return {
    written,
    put: (key: string, body: Uint8Array) => {
      written.push({ key, body: new TextDecoder().decode(body) });
      return Promise.resolve();
    },
  };
};

const idleWatch = (): CancelWatch => ({
  cancelled: () => false,
  stop: () => Promise.resolve(),
  signal: new Promise<void>(() => undefined),
});

const cancelledWatch = (): CancelWatch => ({
  cancelled: () => true,
  stop: () => Promise.resolve(),
  signal: Promise.resolve(),
});

const request = (input: Record<string, unknown>) => ({
  runId: 'run-1',
  manifest: expandUrl,
  input,
  secretsRef: [],
  limits,
  cancelToken: 'cancel:run-1',
});

describe('builtin executor', () => {
  it('registers only modules this build ships', () => {
    expect(requireBuiltin('expand-url').name).toBe('expand-url');
    expect(() => requireBuiltin('rm-rf')).toThrow(/MANIFEST_INVALID/);
  });

  it('expands a URL and stores one primary artifact', async () => {
    const store = sink();
    const executor = createBuiltinExecutor({
      sink: store,
      bucket: 'raven',
      orgId: 'org-1',
      transport: transportReturning(200),
      resolve: () => Promise.resolve(['93.184.216.34']),
      watch: idleWatch(),
    });

    const result = await executor.execute(request({ url: 'https://example.test/landing' }));
    expect(result.status).toBe('succeeded');
    expect(result.artifacts).toHaveLength(1);
    const payload = JSON.parse(store.written[0]?.body ?? '{}') as {
      finalUrl: string;
      version: string;
    };
    expect(payload.finalUrl).toBe('https://example.test/landing');
    expect(payload.version).toBe('1.0');
  });

  it('fails with a canonical error when the input is missing', async () => {
    const executor = createBuiltinExecutor({
      sink: sink(),
      bucket: 'raven',
      orgId: 'org-1',
      transport: transportReturning(200),
      resolve: () => Promise.resolve(['93.184.216.34']),
      watch: idleWatch(),
    });
    const result = await executor.execute(request({}));
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('INPUT_INVALID');
  });

  it('reports a cancelled run as cancelled, not as an internal error', async () => {
    const executor = createBuiltinExecutor({
      sink: sink(),
      bucket: 'raven',
      orgId: 'org-1',
      transport: () => new Promise(() => undefined),
      resolve: () => Promise.resolve(['93.184.216.34']),
      watch: cancelledWatch(),
    });
    const result = await executor.execute(request({ url: 'https://example.test/' }));
    expect(result.status).toBe('cancelled');
    expect(result.error?.code).toBe('CANCELLED');
  });

  it('refuses a private destination through safeFetch (N7)', async () => {
    const executor = createBuiltinExecutor({
      sink: sink(),
      bucket: 'raven',
      orgId: 'org-1',
      transport: transportReturning(200),
      resolve: () => Promise.resolve(['169.254.169.254']),
      watch: idleWatch(),
    });
    const result = await executor.execute(request({ url: 'https://metadata.test/' }));
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});
