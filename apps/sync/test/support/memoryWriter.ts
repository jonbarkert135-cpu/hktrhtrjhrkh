import {
  applyProjectionDiff,
  MemoryProjectionStore,
  type PriorProjectionState,
} from '@nexus/domain';

import type { ProjectionWriter } from '../../src/projection.ts';

/** An in-memory `ProjectionWriter` double — no Postgres needed for the sync unit tests. */
export function createMemoryProjectionWriter() {
  const store = new MemoryProjectionStore();
  let failNextApplyDiff: Error | null = null;
  let projectedAt: Date | null = null;
  let failed = false;
  let applyDiffCalls = 0;

  const writer: ProjectionWriter = {
    async loadPriorState(): Promise<PriorProjectionState> {
      return store.toProjectionState();
    },
    async applyDiff(_boardId, diff) {
      applyDiffCalls += 1;
      if (failNextApplyDiff) {
        const error = failNextApplyDiff;
        failNextApplyDiff = null;
        throw error;
      }
      applyProjectionDiff(store, diff);
    },
    async markProjected(_boardId, at) {
      projectedAt = at;
      failed = false;
    },
    async markProjectionFailed() {
      failed = true;
    },
  };

  return {
    writer,
    store,
    failNextApplyDiff(error: Error): void {
      failNextApplyDiff = error;
    },
    get projectedAt() {
      return projectedAt;
    },
    get failed() {
      return failed;
    },
    get applyDiffCalls() {
      return applyDiffCalls;
    },
  };
}
