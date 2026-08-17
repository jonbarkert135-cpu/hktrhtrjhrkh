import type { FastifyInstance } from 'fastify';
import type { ServerEnv } from './env.js';

/**
 * Test-only endpoints (used by e2e to reset state). They must be impossible to expose in
 * production: 19_DEPLOYMENT.md §1.1 already rejects `NEXUS_TEST_ENDPOINTS=true` there, and this
 * is the second, independent gate.
 */
export function testEndpointsAllowed(env: Pick<ServerEnv, 'NODE_ENV' | 'NEXUS_TEST_ENDPOINTS'>) {
  return env.NODE_ENV !== 'production' && env.NEXUS_TEST_ENDPOINTS === true;
}

export function registerTestEndpoints(
  app: FastifyInstance,
  env: Pick<ServerEnv, 'NODE_ENV' | 'NEXUS_TEST_ENDPOINTS'>,
): boolean {
  if (!testEndpointsAllowed(env)) return false;
  app.get('/__test/ping', () => ({ ok: true }));
  return true;
}
