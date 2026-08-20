/**
 * Artifact collection, size caps and hashing (10_INTEGRATIONS.md §6.8, §6.9).
 *
 * Two independent caps: per declared output (`outputs[].maxBytes`) and per run
 * (`limits.maxOutputBytes`). Hitting either truncates rather than fails — a Sherlock run that dies
 * at site 380/400 still has 379 useful results, and the proposal says so.
 */

import { Sha256 } from '@nexus/domain';
import type { ArtifactRef } from '@nexus/integrations';

/** Stdout/stderr ring buffer: keep the first and last MiB with an elision marker (§6.8). */
export const STREAM_CAP_BYTES = 2 * 1024 * 1024;
export const STREAM_HALF_BYTES = STREAM_CAP_BYTES / 2;

export class StreamRingBuffer {
  private head: Uint8Array[] = [];
  private tail: Uint8Array[] = [];
  private headBytes = 0;
  private tailBytes = 0;
  private elided = 0;

  push(chunk: Uint8Array): void {
    if (this.headBytes < STREAM_HALF_BYTES) {
      this.head.push(chunk);
      this.headBytes += chunk.byteLength;
      return;
    }
    this.tail.push(chunk);
    this.tailBytes += chunk.byteLength;
    while (this.tailBytes > STREAM_HALF_BYTES && this.tail.length > 1) {
      const dropped = this.tail.shift();
      if (dropped === undefined) break;
      this.tailBytes -= dropped.byteLength;
      this.elided += dropped.byteLength;
    }
  }

  get truncated(): boolean {
    return this.elided > 0;
  }

  text(): string {
    const decoder = new TextDecoder('utf-8');
    const head = this.head.map((chunk) => decoder.decode(chunk, { stream: true })).join('');
    const tail = this.tail.map((chunk) => decoder.decode(chunk, { stream: true })).join('');
    if (this.elided === 0) return head + tail;
    return `${head}\n«… ${String(this.elided)} bytes elided …»\n${tail}`;
  }
}

export interface ArtifactSink {
  /** Streams bytes to `runs/<orgId>/<runId>/<name>`; returns the stored size. */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export const artifactKey = (orgId: string, runId: string, name: string): string =>
  `runs/${orgId}/${runId}/${name}`;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  json: 'application/json',
  ndjson: 'application/x-ndjson',
  csv: 'text/csv',
  text: 'text/plain',
  html: 'text/html',
  binary: 'application/octet-stream',
};

export interface CollectOptions {
  readonly orgId: string;
  readonly runId: string;
  readonly name: string;
  readonly kind: keyof typeof CONTENT_TYPES;
  readonly maxBytes: number;
  /** Remaining budget from `limits.maxOutputBytes`, shared across all artifacts of the run. */
  readonly runBudget: number;
  readonly bucket: string;
}

export interface CollectedArtifact {
  readonly ref: ArtifactRef;
  readonly bytesWritten: number;
}

/** Truncates at the smaller of the two caps, hashes what was kept, and uploads it. */
export async function collectArtifact(
  sink: ArtifactSink,
  body: Uint8Array,
  options: CollectOptions,
): Promise<CollectedArtifact> {
  const cap = Math.max(0, Math.min(options.maxBytes, options.runBudget));
  const truncated = body.byteLength > cap;
  const kept = truncated ? body.subarray(0, cap) : body;
  const contentType = CONTENT_TYPES[options.kind] ?? 'application/octet-stream';
  const key = artifactKey(options.orgId, options.runId, options.name);
  await sink.put(key, kept, contentType);
  return {
    bytesWritten: kept.byteLength,
    ref: {
      bucket: options.bucket,
      key,
      bytes: kept.byteLength,
      sha256: new Sha256().update(kept).hex(),
      contentType,
      truncated,
    },
  };
}
