import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadServerEnv, SECRET_ENV_KEYS, clientEnv } from '../src/env';

const SECRET = 'x'.repeat(32);

const valid = (): Record<string, string> => ({
  NODE_ENV: 'development',
  NEXUS_ENV: 'local',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/nexus',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'nexus',
  S3_ACCESS_KEY_ID: 'minio',
  S3_SECRET_ACCESS_KEY: 'minio123',
  AUTH_SECRET: SECRET,
  AUTH_TRUSTED_ORIGINS: 'http://localhost:5173,http://localhost:3000',
  PUBLIC_APP_URL: 'http://localhost:5173',
  SYNC_URL: 'ws://localhost:1234',
  SYNC_SHARED_SECRET: SECRET,
  RUNNER_URL: 'http://localhost:4000',
  RUNNER_SHARED_SECRET: SECRET,
  EGRESS_PROXY_URL: 'http://localhost:3128',
});

describe('loadServerEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = loadServerEnv(valid());
    expect(env.DATABASE_POOL_MAX).toBe(20);
    expect(env.S3_REGION).toBe('us-east-1');
    expect(env.AI_PROVIDER).toBe('mock');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.NEXUS_TEST_ENDPOINTS).toBe(false);
    expect(env.AUTH_TRUSTED_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:3000']);
  });

  it.each([
    ['DATABASE_URL', 'not-a-url'],
    ['REDIS_URL', 'nope'],
    ['AUTH_SECRET', 'too-short'],
    ['S3_BUCKET', ''],
    ['NODE_ENV', 'staging'],
    ['NEXUS_ENV', 'dev'],
    ['DATABASE_POOL_MAX', '1'],
    ['LOG_LEVEL', 'verbose'],
  ])('rejects an invalid %s', (key, value) => {
    expect(() => loadServerEnv({ ...valid(), [key]: value })).toThrow(EnvValidationError);
  });

  it('reports every offending variable, one readable line each', () => {
    const raw = { ...valid(), DATABASE_URL: 'x', REDIS_URL: 'y' };
    delete (raw as Record<string, unknown>).AUTH_SECRET;
    try {
      loadServerEnv(raw);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as EnvValidationError).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('REDIS_URL');
      expect(message).toContain('AUTH_SECRET');
      expect((error as EnvValidationError).issues).toHaveLength(3);
      expect(message.split('\n').length).toBeGreaterThan(3);
    }
  });

  it('rejects NEXUS_TEST_ENDPOINTS=true in production', () => {
    const raw = { ...valid(), NODE_ENV: 'production', NEXUS_ENV: 'production', NEXUS_TEST_ENDPOINTS: 'true' };
    expect(() => loadServerEnv(raw)).toThrow(/NEXUS_TEST_ENDPOINTS must be false in production/);
  });

  it('allows NEXUS_TEST_ENDPOINTS=true outside production', () => {
    expect(loadServerEnv({ ...valid(), NEXUS_TEST_ENDPOINTS: 'true' }).NEXUS_TEST_ENDPOINTS).toBe(true);
  });

  it('requires AI_API_KEY for a non-mock provider', () => {
    expect(() => loadServerEnv({ ...valid(), AI_PROVIDER: 'openai-compatible' })).toThrow(
      /AI_API_KEY required for a non-mock provider/,
    );
    expect(
      loadServerEnv({ ...valid(), AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test' })
        .AI_PROVIDER,
    ).toBe('openai-compatible');
  });
});

describe('clientEnv', () => {
  it('contains no server secret names', () => {
    const keys = Object.keys(clientEnv.shape);
    for (const secret of SECRET_ENV_KEYS) expect(keys).not.toContain(secret);
    expect(keys.every((k) => k.startsWith('VITE_'))).toBe(true);
  });
});
