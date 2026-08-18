import { describe, expect, it, vi } from 'vitest';

const loadServerEnvFromProcess = vi.fn(() => ({
  S3_ENDPOINT: 'https://s3.example.com',
  S3_REGION: 'eu-central-1',
  S3_BUCKET: 'raven',
  S3_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_FORCE_PATH_STYLE: false,
}));

vi.mock('../src/env.ts', () => ({ loadServerEnvFromProcess }));

const { getStorage } = await import('../src/files/storage.ts');

describe('getStorage', () => {
  it('builds the client from the validated env and reuses it', () => {
    const first = getStorage();
    const url = new URL(first.presignPut('org/o1/f1/a.png', 900));

    expect(url.host).toBe('raven.s3.example.com');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('eu-central-1');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');

    expect(getStorage()).toBe(first);
    // Memoized: the env is read once per process, not once per presigned URL.
    expect(loadServerEnvFromProcess).toHaveBeenCalledTimes(1);
  });
});
