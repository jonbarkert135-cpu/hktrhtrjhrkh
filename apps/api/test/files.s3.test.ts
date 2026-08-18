import { describe, expect, it, vi } from 'vitest';
import { createS3Client, presignS3Url, type Fetcher, type S3Config } from '../src/files/s3.ts';

const config: S3Config = {
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'raven',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  forcePathStyle: false,
};

const NOW = new Date('2026-08-18T11:00:00.000Z');

describe('presignS3Url', () => {
  it('reproduces the AWS SigV4 reference vector for a presigned GET', () => {
    // "Example: Signature Calculation for Presigned URL" — AWS S3 API reference (Signature V4).
    const url = new URL(
      presignS3Url(
        {
          endpoint: 'https://s3.amazonaws.com',
          region: 'us-east-1',
          bucket: 'examplebucket',
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          forcePathStyle: false,
        },
        {
          method: 'GET',
          key: 'test.txt',
          expiresInSeconds: 86_400,
          now: new Date('2013-05-24T00:00:00.000Z'),
        },
      ),
    );
    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('signs a virtual-hosted PUT with every required query parameter', () => {
    const url = new URL(
      presignS3Url(config, {
        method: 'PUT',
        key: 'org/o1/a b.png',
        expiresInSeconds: 900,
        now: NOW,
      }),
    );
    expect(url.host).toBe('raven.s3.example.com');
    expect(url.pathname).toBe('/org/o1/a%20b.png');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      'AKIAIOSFODNN7EXAMPLE/20260818/us-east-1/s3/aws4_request',
    );
    expect(url.searchParams.get('X-Amz-Date')).toBe('20260818T110000Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('puts the bucket in the path when MinIO path style is on', () => {
    const url = new URL(
      presignS3Url(
        { ...config, forcePathStyle: true, endpoint: 'http://minio:9000' },
        { method: 'GET', key: 'k', expiresInSeconds: 60, now: NOW },
      ),
    );
    expect(url.host).toBe('minio:9000');
    expect(url.pathname).toBe('/raven/k');
  });

  it('is deterministic, and the signature covers the method, the key and the expiry', () => {
    const sign = (over: Partial<Parameters<typeof presignS3Url>[1]>): string =>
      new URL(
        presignS3Url(config, {
          method: 'GET',
          key: 'a',
          expiresInSeconds: 900,
          now: NOW,
          ...over,
        }),
      ).searchParams.get('X-Amz-Signature') ?? '';

    const base = sign({});
    expect(sign({})).toBe(base);
    expect(sign({ method: 'PUT' })).not.toBe(base);
    expect(sign({ key: 'b' })).not.toBe(base);
    expect(sign({ expiresInSeconds: 60 })).not.toBe(base);
    expect(sign({ now: new Date('2026-08-19T11:00:00.000Z') })).not.toBe(base);
  });

  it('signs extra query parameters such as the download disposition', () => {
    const url = new URL(
      presignS3Url(config, {
        method: 'GET',
        key: 'k',
        expiresInSeconds: 900,
        now: NOW,
        query: { 'response-content-disposition': 'attachment; filename="a b.pdf"' },
      }),
    );
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="a b.pdf"',
    );
  });
});

describe('createS3Client', () => {
  const response = (over: Partial<Awaited<ReturnType<Fetcher>>> = {}) =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
      ...over,
    }) as Awaited<ReturnType<Fetcher>>;

  it('reads the byte count from a HEAD, and reports null when the object is missing', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(response({ headers: { get: () => '1234' } }))
      .mockResolvedValueOnce(response({ ok: false, status: 404 }));
    const client = createS3Client(config, fetcher);

    expect(await client.headBytes('k')).toBe(1234);
    expect(await client.headBytes('missing')).toBeNull();
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('HEAD');
  });

  it('requests exactly the sniff window with a Range header', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValue(response({ arrayBuffer: async () => bytes.buffer }));
    const client = createS3Client(config, fetcher);

    expect(await client.readHead('k', 64)).toEqual(bytes);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ range: 'bytes=0-63' });
  });

  it('returns nothing readable when the ranged GET fails', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(response({ ok: false, status: 403 }));
    expect(await createS3Client(config, fetcher).readHead('k', 64)).toEqual(new Uint8Array());
  });

  it('deletes through a signed DELETE', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(response());
    await createS3Client(config, fetcher).remove('k');
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('marks non-inline downloads as attachments and strips quotes from the filename', () => {
    const url = new URL(
      createS3Client(config, vi.fn<Fetcher>()).presignGet('k', 900, {
        filename: 'we"ird.zip',
        attachment: true,
      }),
    );
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="weird.zip"',
    );
  });
});
