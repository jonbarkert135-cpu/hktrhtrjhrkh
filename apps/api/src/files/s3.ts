/**
 * Minimal S3 client: SigV4 query presigning plus the three object calls the upload pipeline needs
 * (HEAD, ranged GET, DELETE), executed through presigned URLs with `fetch`.
 *
 * ponytail: hand-written instead of `@aws-sdk/client-s3`. The SDK adds ~2 MB and a large
 * transitive tree to an image that must stay small and `pnpm audit`-clean, and we use four
 * operations out of ~90. SigV4 is a stable, fully specified algorithm and is pinned here by
 * the AWS test vectors in `test/files.s3.test.ts`.
 * Upgrade path: if multipart, replication or lifecycle APIs are ever needed, replace the module
 * body — every caller goes through the exported functions below.
 */
import { createHash, createHmac } from 'node:crypto';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface PresignOptions {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  key: string;
  expiresInSeconds: number;
  /** Extra query parameters, e.g. `response-content-disposition`. */
  query?: Record<string, string>;
  /** Signing time; injected by tests so signatures are reproducible. */
  now?: Date;
}

const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** S3 keys are path segments: encode each segment, keep the slashes. */
const encodeKey = (key: string): string => key.split('/').map(encodeRfc3986).join('/');

const sha256Hex = (data: string): string => createHash('sha256').update(data).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

const amzDate = (date: Date): { stamp: string; iso: string } => {
  const iso = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return { stamp: iso.slice(0, 8), iso };
};

/**
 * A presigned URL valid for `expiresInSeconds`. The signature covers method, host, path and every
 * query parameter, so a leaked URL cannot be replayed against a different key or verb.
 */
export function presignS3Url(config: S3Config, options: PresignOptions): string {
  const endpoint = new URL(config.endpoint);
  const host = config.forcePathStyle ? endpoint.host : `${config.bucket}.${endpoint.host}`;
  const path = config.forcePathStyle
    ? `${endpoint.pathname.replace(/\/$/, '')}/${config.bucket}/${encodeKey(options.key)}`
    : `${endpoint.pathname.replace(/\/$/, '')}/${encodeKey(options.key)}`;

  const { stamp, iso } = amzDate(options.now ?? new Date());
  const scope = `${stamp}/${config.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    ...options.query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${scope}`,
    'X-Amz-Date': iso,
    'X-Amz-Expires': String(options.expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k] ?? '')}`)
    .join('&');

  const canonicalRequest = [
    options.method,
    path,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', iso, scope, sha256Hex(canonicalRequest)].join('\n');

  // kSigning = HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), "s3"), "aws4_request")
  const signingKey = [config.region, 's3', 'aws4_request'].reduce(
    (key, part) => hmac(key, part),
    hmac(`AWS4${config.secretAccessKey}`, stamp),
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return `${endpoint.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** The subset of `fetch` this module uses; injected so tests never touch the network. */
export type Fetcher = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

export interface S3Client {
  presignPut: (key: string, expiresInSeconds: number) => string;
  presignGet: (
    key: string,
    expiresInSeconds: number,
    options?: { filename?: string; attachment?: boolean },
  ) => string;
  /** Byte size of the stored object, or `null` when it is not there. */
  headBytes: (key: string) => Promise<number | null>;
  /** First `length` bytes of the object, for magic-byte sniffing. */
  readHead: (key: string, length: number) => Promise<Uint8Array>;
  remove: (key: string) => Promise<void>;
}

export function createS3Client(config: S3Config, fetcher: Fetcher): S3Client {
  const url = (options: PresignOptions): string => presignS3Url(config, options);
  return {
    presignPut: (key, expiresInSeconds) => url({ method: 'PUT', key, expiresInSeconds }),

    presignGet: (key, expiresInSeconds, options) =>
      url({
        method: 'GET',
        key,
        expiresInSeconds,
        query:
          options?.attachment === true
            ? {
                'response-content-disposition': `attachment; filename="${(options.filename ?? 'download').replace(/["\\]/g, '')}"`,
              }
            : {},
      }),

    headBytes: async (key) => {
      const response = await fetcher(url({ method: 'HEAD', key, expiresInSeconds: 60 }), {
        method: 'HEAD',
      });
      if (!response.ok) return null;
      const length = Number(response.headers.get('content-length'));
      return Number.isFinite(length) ? length : null;
    },

    readHead: async (key, length) => {
      const response = await fetcher(url({ method: 'GET', key, expiresInSeconds: 60 }), {
        method: 'GET',
        headers: { range: `bytes=0-${Math.max(0, length - 1)}` },
      });
      if (!response.ok) return new Uint8Array();
      return new Uint8Array(await response.arrayBuffer());
    },

    remove: async (key) => {
      await fetcher(url({ method: 'DELETE', key, expiresInSeconds: 60 }), { method: 'DELETE' });
    },
  };
}
