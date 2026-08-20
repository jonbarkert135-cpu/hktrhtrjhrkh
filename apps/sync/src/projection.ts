/**
 * The sync-service side of the projection contract (P8 §5.3/§5.4, 08_DATA_MODEL.md §5). The pure
 * diff/apply algorithm lives in `packages/domain/src/projection`; this module is the thin,
 * injectable I/O shell: it loads the prior projected state, calls the domain diff, writes rows
 * through a `ProjectionWriter`, and never lets a projection failure block the snapshot write
 * (P8 §4 — the failure is recorded and retried, the binary is still committed).
 */

import { diffBoardDoc, type PriorProjectionState, type ProjectionDiff } from '@nexus/domain';
import type * as Y from 'yjs';

import { syncProjectionDuration, syncProjectionFailuresTotal } from './metrics.ts';

export interface ProjectionWriter {
  /** The rows currently projected for this board, keyed for the `isNewer` ordering guard. */
  loadPriorState(boardId: string): Promise<PriorProjectionState>;
  /** Applies one diff — implementations upsert/delete in dependency order inside one transaction. */
  applyDiff(boardId: string, diff: ProjectionDiff): Promise<void>;
  /** Marks the board's projection healthy/stale for the admin view (P8 §4). */
  markProjected(boardId: string, at: Date): Promise<void>;
  markProjectionFailed(boardId: string): Promise<void>;
}

export interface ProjectionRetryPolicy {
  /** Exponential backoff in ms, capped; used between automatic retries of a failed projection. */
  delays: readonly number[];
}

export const DEFAULT_RETRY_POLICY: ProjectionRetryPolicy = {
  delays: [1_000, 5_000, 15_000],
};

export interface ProjectBoardOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  retry?: ProjectionRetryPolicy;
}

/**
 * Projects `doc` for `boardId` through `writer`, retrying with backoff on failure. Always
 * resolves (never throws) — a projection that fails all its retries is recorded via
 * `raven_sync_projection_failures_total` and the board is flagged stale; the CRDT snapshot,
 * written separately by the caller, is never affected by this function's outcome (P8 §4).
 */
export async function projectBoard(
  doc: Y.Doc,
  boardId: string,
  writer: ProjectionWriter,
  options: ProjectBoardOptions = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const retry = options.retry ?? DEFAULT_RETRY_POLICY;

  const attempts = [0, ...retry.delays];
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const delay = attempts[attempt] ?? 0;
    if (delay > 0) await sleep(delay);

    const stopTimer = syncProjectionDuration.startTimer();
    try {
      const prior = await writer.loadPriorState(boardId);
      const diff = diffBoardDoc(doc, prior);
      await writer.applyDiff(boardId, diff);
      await writer.markProjected(boardId, new Date(now()));
      stopTimer();
      return { ok: true };
    } catch (error) {
      stopTimer();
      lastError = error;
      const reason = error instanceof Error ? error.constructor.name : 'unknown';
      syncProjectionFailuresTotal.inc({ reason });
    }
  }

  await writer.markProjectionFailed(boardId);
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return { ok: false, reason: message };
}
