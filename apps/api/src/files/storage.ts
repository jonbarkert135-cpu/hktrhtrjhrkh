/**
 * The process-wide S3 client, built once from the validated server env (19_DEPLOYMENT.md §1.1).
 * Routers depend on this module rather than on the env, so tests substitute the whole module.
 */
import { loadServerEnvFromProcess } from '../env.ts';
import { createS3Client, type S3Client } from './s3.ts';

let client: S3Client | null = null;

export function getStorage(): S3Client {
  if (client === null) {
    const env = loadServerEnvFromProcess();
    client = createS3Client(
      {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      },
      // `fetch` is global from Node 18; the structural type in `s3.ts` keeps the module testable.
      fetch,
    );
  }
  return client;
}
