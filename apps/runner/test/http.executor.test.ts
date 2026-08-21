/**
 * The `http` execution layer: templated requests, secret headers, upstream status mapping and the
 * same cancellation/timeout contract the container path has.
 */

import { describe, expect, it } from 'vitest';
import type { Transport } from '@nexus/domain';
import { effectiveLimits, networkPolicyOf, parseManifest } from '@nexus/integrations';

import { createHttpExecutor } from '../src/executors/http.ts';
import type { CancelWatch } from '../src/cancel.ts';

const manifest = parseManifest({
  manifestVersion: 1,
  id: 'http-tool',
  name: 'HTTP tool',
  version: '1.0.0',
  toolVersion: '2.0.0',
  publisher: { name: 'Raven core' },
  icon: 'integrations/test',
  repository: 'https://example.test/repo',
  license: 'MIT',
  description: 'A hosted API manifest used to exercise the http execution layer in tests.',
  capabilities: ['scan-domain'],
  inputs: [{ name: 'target', label: 'Target', type: 'string', from: { source: 'form' } }],
  outputs: [{ name: 'result', kind: 'json', primary: true }],
  permissions: ['graph:propose', 'net:allowlist', 'secrets:read'],
  execution: {
    kind: 'http',
    baseUrl: 'https://api.example.test/v1/',
    requests: [
      {
        name: 'lookup',
        method: 'GET',
        path: '/lookup/{{input.target}}',
        query: { q: '{{input.target}}' },
        headers: { accept: 'application/json' },
        secretHeaders: { authorization: 'tool.api', 'x-absent': 'tool.absent' },
        collectAs: 'result',
      },
    ],
    network: { mode: 'allowlist', allow: ['api.example.test'], denyPrivateRanges: true },
    limits: { wallClockMs: 60_000, maxOutputBytes: 4096 },
  },
  parser: { module: 'x', supportedOutputVersions: ['2.0'] },
  rateLimits: {},
  costHints: { typicalDurationMs: 1000, typicalOutboundRequests: 1, typicalNewNodes: 1 },
  maturity: 'experimental',
  risk: { label: 'low', upstreamMaintenance: 'unknown' },
  consent: {
    scopeText: 'I confirm I am authorized to query this target and that it is lawful where I am.',
    allowedTargetScopes: ['owned-asset'],
  },
});

const limits = effectiveLimits(manifest.execution.limits, networkPolicyOf(manifest));

const seen: { url: string; headers: Record<string, string> }[] = [];

function transportReturning(status: number, body = '{"ok":true}'): Transport {
  return (request) => {
    seen.push({ url: request.url.href, headers: { ...request.headers } });
    return Promise.resolve({
      status,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      body: async function* () {
        yield new TextEncoder().encode(body);
      },
    });
  };
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

const request = (over: Record<string, unknown> = {}) => ({
  runId: 'run-1',
  manifest,
  input: { target: 'example.test' },
  secretsRef: [],
  limits,
  cancelToken: 'cancel:run-1',
  ...over,
});

const deps = (over: Record<string, unknown> = {}) => ({
  sink: sink(),
  bucket: 'raven',
  orgId: 'org-1',
  transport: transportReturning(200),
  resolve: () => Promise.resolve(['93.184.216.34']),
  watch: idleWatch(),
  ...over,
});

describe('http executor', () => {
  it('renders path and query, injects only known secret headers, and stores the artifact', async () => {
    seen.length = 0;
    const store = sink();
    const executor = createHttpExecutor(
      deps({ sink: store, secrets: { 'tool.api': 'Bearer sekrit-value' } }),
    );

    const result = await executor.execute(request());
    expect(result.status).toBe('succeeded');
    expect(result.exitCode).toBe(0);
    expect(result.artifacts).toHaveLength(1);
    expect(result.stats.egressRequests).toBe(1);
    expect(seen[0]?.url).toBe('https://api.example.test/v1/lookup/example.test?q=example.test');
    expect(seen[0]?.headers.authorization).toBe('Bearer sekrit-value');
    expect(seen[0]?.headers['x-absent']).toBeUndefined();
    expect(store.written[0]?.key).toContain('runs/org-1/run-1/result');
  });

  it('redacts secret values that the upstream echoes back', async () => {
    const store = sink();
    const executor = createHttpExecutor(
      deps({
        sink: store,
        transport: transportReturning(200, '{"echo":"sekrit-value"}'),
        secrets: { 'tool.api': 'sekrit-value' },
      }),
    );
    await executor.execute(request());
    expect(store.written[0]?.body).toBe('{"echo":"«redacted:tool.api»"}');
  });

  it.each([
    [401, 'UPSTREAM_AUTH_FAILED'],
    [403, 'UPSTREAM_AUTH_FAILED'],
    [429, 'UPSTREAM_RATE_LIMITED'],
    [503, 'UPSTREAM_UNAVAILABLE'],
  ])('maps upstream %i to %s', async (status, code) => {
    const executor = createHttpExecutor(deps({ transport: transportReturning(status) }));
    const result = await executor.execute(request());
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe(code);
  });

  it('refuses a non-http manifest, because that is a wiring bug', async () => {
    const executor = createHttpExecutor(deps());
    const builtin = {
      ...manifest,
      execution: {
        kind: 'builtin' as const,
        module: 'expand-url',
        limits: manifest.execution.limits,
      },
    };
    await expect(executor.execute(request({ manifest: builtin }))).rejects.toThrow(/INTERNAL/);
  });

  it('reports a cancelled run as cancelled', async () => {
    const executor = createHttpExecutor(
      deps({ transport: () => new Promise(() => undefined), watch: cancelledWatch() }),
    );
    const result = await executor.execute(request());
    expect(result.status).toBe('cancelled');
    expect(result.error?.code).toBe('CANCELLED');
  });

  it('times out on the wall clock and can be cancelled by run id', async () => {
    const executor = createHttpExecutor(deps({ transport: () => new Promise(() => undefined) }));
    const pending = executor.execute(request({ limits: { ...limits, wallClockMs: 1000 } }));
    await executor.cancel('run-1');
    await executor.cancel('unknown-run');
    const result = await pending;
    expect(result.status).toBe('timed_out');
    expect(result.error?.code).toBe('TIMEOUT');
  });

  it('fails with a canonical payload when the destination is private (N7)', async () => {
    const executor = createHttpExecutor(
      deps({ resolve: () => Promise.resolve(['169.254.169.254']) }),
    );
    const result = await executor.execute(request());
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });
});
