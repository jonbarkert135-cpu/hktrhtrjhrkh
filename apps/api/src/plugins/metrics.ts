import fp from 'fastify-plugin';
import Fastify from 'fastify';
import { Counter, Histogram, Registry } from 'prom-client';
import type { FastifyInstance } from 'fastify';

export const registry = new Registry();

const requests = new Counter({
  name: 'raven_http_requests_total',
  help: 'HTTP requests handled by the API',
  labelNames: ['service', 'method', 'route', 'status'] as const,
  registers: [registry],
});

const duration = new Histogram({
  name: 'raven_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['service', 'route'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

const SERVICE = 'raven-api';

/** Records the two metrics 19_DEPLOYMENT.md §10.2 mandates for every API response. */
export const metricsPlugin = fp((app: FastifyInstance, _opts, done: () => void) => {
  app.addHook('onResponse', (req, reply, hookDone) => {
    const route = req.routeOptions.url ?? 'unmatched';
    requests.inc({
      service: SERVICE,
      method: req.method,
      route,
      status: String(reply.statusCode),
    });
    duration.observe({ service: SERVICE, route }, reply.elapsedTime / 1000);
    hookDone();
  });
  done();
});

/** Metrics live on their own port so they are never exposed through the public ingress. */
export async function startMetricsServer(port = 9464): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/metrics', (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
  await app.listen({ port, host: '0.0.0.0' });
  return app;
}
