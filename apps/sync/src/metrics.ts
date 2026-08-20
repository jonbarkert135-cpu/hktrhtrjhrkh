/**
 * The sync-service metrics (19_DEPLOYMENT.md §10.2 "Sync" block, P8 §12/acceptance §7). Names and
 * label sets are copied verbatim — the spec says "implementations must use exactly these".
 */

import Fastify from 'fastify';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { FastifyInstance } from 'fastify';

export const registry = new Registry();

export const syncConnections = new Gauge({
  name: 'raven_sync_connections',
  help: 'Open WebSocket connections to the sync service',
  labelNames: ['board_scope'] as const,
  registers: [registry],
});

export const syncRoomsOpen = new Gauge({
  name: 'raven_sync_rooms_open',
  help: 'Hocuspocus rooms currently held in memory',
  registers: [registry],
});

export const syncUpdateBytesTotal = new Counter({
  name: 'raven_sync_update_bytes_total',
  help: 'Bytes of Yjs update traffic',
  labelNames: ['direction'] as const, // 'in' | 'out'
  registers: [registry],
});

export const syncBroadcastLatency = new Histogram({
  name: 'raven_sync_broadcast_latency_seconds',
  help: 'Time from receiving an update to broadcasting it to other clients in the room',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const syncProjectionDuration = new Histogram({
  name: 'raven_sync_projection_duration_seconds',
  help: 'Time spent projecting one store cycle into Postgres',
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1.5, 3, 5],
  registers: [registry],
});

export const syncProjectionFailuresTotal = new Counter({
  name: 'raven_sync_projection_failures_total',
  help: 'Projection attempts that raised and were retried',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const syncDocMemoryBytes = new Gauge({
  name: 'raven_sync_doc_memory_bytes',
  help: 'Estimated resident memory of open Y.Doc rooms',
  labelNames: ['quantile'] as const,
  registers: [registry],
});

export const syncAwarenessClients = new Gauge({
  name: 'raven_sync_awareness_clients',
  help: 'Distinct awareness clients (userId+tabId) across all open rooms',
  registers: [registry],
});

/** Metrics live on their own port, same convention as `apps/api` (19_DEPLOYMENT.md §10.2). */
export async function startMetricsServer(port = 9465): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/metrics', (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
  await app.listen({ port, host: '0.0.0.0' });
  return app;
}
