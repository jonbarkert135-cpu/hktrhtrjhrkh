import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { metricsPlugin, registry, startMetricsServer } from '../src/plugins/metrics.ts';
import { REQ_ID_HEADER, requestContextPlugin } from '../src/plugins/request-context.ts';

const build = async () => {
  const app = Fastify({
    logger: false,
    genReqId: (req) => {
      const header = req.headers[REQ_ID_HEADER];
      return (Array.isArray(header) ? header[0] : header) ?? 'generated-id';
    },
  });
  await app.register(requestContextPlugin);
  await app.register(metricsPlugin);
  app.get('/ok', () => ({ ok: true }));
  await app.ready();
  return app;
};

beforeEach(() => {
  registry.resetMetrics();
});

describe('request-context plugin', () => {
  it('echoes an inbound request id back to the caller', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { [REQ_ID_HEADER]: 'from-client' },
    });
    expect(res.headers[REQ_ID_HEADER]).toBe('from-client');
    await app.close();
  });

  it('falls back to the generated id and sets it even on a 404', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.headers[REQ_ID_HEADER]).toBe('generated-id');
    await app.close();
  });
});

describe('metrics plugin', () => {
  it('counts responses and times them, labelled by route and status', async () => {
    const app = await build();
    await app.inject({ method: 'GET', url: '/ok' });
    await app.inject({ method: 'GET', url: '/missing' });
    await app.close();

    const metrics = await registry.metrics();
    expect(metrics).toContain('raven_http_requests_total');
    expect(metrics).toContain('raven_http_request_duration_seconds');
    expect(metrics).toMatch(
      /raven_http_requests_total\{service="raven-api",method="GET",route="\/ok",status="200"\}/,
    );
    expect(metrics).toMatch(/route="unmatched",status="404"/);
    expect(metrics).toMatch(/raven_http_request_duration_seconds_count\{[^}]*route="\/ok"\} 1/);
  });
});

describe('metrics server', () => {
  it('serves the registry on its own port, separate from the public API', async () => {
    const app = await build();
    await app.inject({ method: 'GET', url: '/ok' });
    await app.close();

    // Port 0 lets the OS pick a free port, so the test never collides with a real service.
    const server = await startMetricsServer(0);
    const address = server.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('raven_http_requests_total');

    await server.close();
  });
});
