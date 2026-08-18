import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { loadServerEnvFromProcess } from '@nexus/config/env-file';

const env = loadServerEnvFromProcess();

/**
 * Prisma connection pool size comes from DATABASE_POOL_MAX (19_DEPLOYMENT.md §1.1). Prisma reads it
 * from the connection string, so it is appended here rather than duplicated in every .env.
 */
function databaseUrl(): string {
  const url = new URL(env.DATABASE_URL);
  url.searchParams.set('connection_limit', String(env.DATABASE_POOL_MAX));
  return url.toString();
}

/** Prisma query logging follows the pino level: debug and below get statements, warn+ stays quiet. */
function logLevels(): Prisma.LogLevel[] {
  switch (env.LOG_LEVEL) {
    case 'trace':
    case 'debug':
      return ['query', 'info', 'warn', 'error'];
    case 'info':
      return ['info', 'warn', 'error'];
    case 'warn':
      return ['warn', 'error'];
    default:
      return ['error'];
  }
}

function createClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl() } },
    log: logLevels(),
  });
}

// Dev/test reload (tsx watch, vitest, Vite HMR) re-evaluates modules; without this every reload
// would open a new pool until Postgres refuses connections.
const globalForPrisma = globalThis as typeof globalThis & { ravenPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.ravenPrisma ?? createClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.ravenPrisma = prisma;
}
