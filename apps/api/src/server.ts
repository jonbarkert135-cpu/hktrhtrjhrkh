import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { createLogger } from '@nexus/config/log';
import { prisma } from '@nexus/db';
import Redis from 'ioredis';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { loadServerEnv } from './env.js';
import type { ServerEnv } from './env.js';
import { createAuth, auditAuthEvent } from './auth/index.js';
import { USER_API_RULE } from './auth/rate-limit.js';
import { metricsPlugin, startMetricsServer } from './plugins/metrics.js';
import { requestContextPlugin, REQ_ID_HEADER } from './plugins/request-context.js';
import { createContextFactory, toHeaders } from './trpc/context.js';
import type { Context } from './trpc/context.js';
import { appRouter } from './trpc/router.js';
import { registerTestEndpoints } from './test-endpoints.js';

export type { AppRouter } from './trpc/router.js';

export async function buildServer(env: ServerEnv): Promise<FastifyInstance> {
  const logger: FastifyBaseLogger = createLogger({
    service: 'nexus-api',
    env: env.NEXUS_ENV,
    version: process.env['NEXUS_VERSION'] ?? '0.1.0',
    level: env.LOG_LEVEL,
  });
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    genReqId: (req) => {
      const header = req.headers[REQ_ID_HEADER];
      return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
    },
  });

  const auth = createAuth(env);

  await app.register(requestContextPlugin);
  await app.register(metricsPlugin);
  await app.register(cookie);
  await app.register(cors, { origin: env.AUTH_TRUSTED_ORIGINS, credentials: true });
  await app.register(rateLimit, {
    max: USER_API_RULE.limit,
    timeWindow: USER_API_RULE.windowMs,
    // Per user when signed in, per IP otherwise. `Retry-After` is sent by the plugin.
    keyGenerator: (req) => req.cookies['nexus.session_token'] ?? req.ip,
  });

  // Better-Auth owns /auth/* (sign-up, sign-in, OAuth callbacks, sign-out).
  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    handler: async (req, reply) => {
      const url = new URL(req.url, env.PUBLIC_APP_URL);
      const request = new Request(url, {
        method: req.method,
        headers: toHeaders(req),
        ...(req.method === 'GET' ? {} : { body: JSON.stringify(req.body ?? {}) }),
      });
      const response = await auth.handler(request);
      await auditAuthEvent(
        {
          path: url.pathname,
          status: response.status,
          email: (req.body as { email?: unknown } | undefined)?.email,
          ip: req.ip,
        },
        app.log,
      );
      reply.status(enumerationSafeStatus(url.pathname, response.status));
      for (const [key, value] of response.headers) reply.header(key, value);
      return enumerationSafeBody(url.pathname, response);
    },
  });

  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: createContextFactory(auth),
      onError({
        error,
        path,
        ctx,
      }: {
        error: Error;
        path: string | undefined;
        ctx: Context | undefined;
      }) {
        app.log.error(
          { event: 'trpc.error', path: path ?? null, req_id: ctx?.req_id ?? null, err: error },
          'trpc procedure failed',
        );
      },
    },
  });

  app.get('/healthz', () => ({ status: 'ok' }));

  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  let draining = false;
  app.get('/readyz', async (_req, reply) => {
    if (draining) return reply.status(503).send({ status: 'draining' });
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      return { status: 'ready' };
    } catch (error) {
      app.log.error({ event: 'readyz.failed', err: error }, 'dependency unreachable');
      return reply.status(503).send({ status: 'not-ready' });
    }
  });

  registerTestEndpoints(app, env);

  app.addHook('onClose', async () => {
    draining = true;
    redis.disconnect();
    await prisma.$disconnect();
  });

  return app;
}

/**
 * P1 §8 — signup must not reveal whether an address is already registered. Better-Auth answers
 * 422 USER_ALREADY_EXISTS; we answer the same 200 shape as a fresh signup.
 * ponytail: the response says "check your inbox" without an email being sent (no mailer in P1).
 * Upgrade path: when the mailer lands, send a "you already have an account" email here.
 */
function enumerationSafeStatus(pathname: string, status: number): number {
  return pathname.endsWith('/sign-up/email') && status === 422 ? 200 : status;
}

async function enumerationSafeBody(pathname: string, response: Response): Promise<unknown> {
  const text = await response.text();
  if (pathname.endsWith('/sign-up/email') && response.status === 422) {
    return { ok: true, message: 'If that address can be used, we sent a link to it.' };
  }
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main(): Promise<void> {
  let env: ServerEnv;
  try {
    env = loadServerEnv();
  } catch (error) {
    process.stderr.write(
      `Invalid configuration — the API cannot start:\n${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  const app = await buildServer(env);
  const metrics = await startMetricsServer();
  await app.listen({ port: 3000, host: '0.0.0.0' });

  const shutdown = (signal: string) => {
    void (async () => {
      app.log.info({ event: 'server.shutdown', signal }, 'shutting down');
      await app.close();
      await metrics.close();
      process.exit(0);
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only boot when executed directly; importing the module (tests) must not listen.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
