import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerTestEndpoints, testEndpointsAllowed } from '../src/test-endpoints.ts';

describe('test-only endpoints', () => {
  it('refuses to register in production even when the flag is on', () => {
    expect(testEndpointsAllowed({ NODE_ENV: 'production', NEXUS_TEST_ENDPOINTS: true })).toBe(
      false,
    );
  });

  it('refuses to register when the flag is off', () => {
    expect(testEndpointsAllowed({ NODE_ENV: 'development', NEXUS_TEST_ENDPOINTS: false })).toBe(
      false,
    );
  });

  it('registers only in a non-production env with the flag on', async () => {
    const app = Fastify({ logger: false });
    const registered = registerTestEndpoints(app, {
      NODE_ENV: 'test',
      NEXUS_TEST_ENDPOINTS: true,
    });
    expect(registered).toBe(true);
    const res = await app.inject({ method: 'GET', url: '/__test/ping' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('leaves the route unrouted when disabled', async () => {
    const app = Fastify({ logger: false });
    registerTestEndpoints(app, { NODE_ENV: 'production', NEXUS_TEST_ENDPOINTS: true });
    const res = await app.inject({ method: 'GET', url: '/__test/ping' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
