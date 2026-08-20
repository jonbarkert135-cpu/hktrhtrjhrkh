/**
 * P8 §11: `apps/sync/test/projection.idempotent.test.ts` — re-running the projection produces no
 * changes, and a failing `applyDiff` never blocks a later successful retry nor corrupts state.
 */

import { describe, expect, it, vi } from 'vitest';

import { projectBoard } from '../src/projection.ts';
import { createMemoryProjectionWriter } from './support/memoryWriter.ts';
import { fixtureBoard } from './support/fixtureBoard.ts';

describe('projectBoard', () => {
  it('re-running against an unchanged doc upserts nothing new', async () => {
    const { doc } = fixtureBoard(4, 3);
    const memory = createMemoryProjectionWriter();

    const first = await projectBoard(doc, 'b1', memory.writer);
    expect(first).toEqual({ ok: true });
    expect(memory.applyDiffCalls).toBe(1);

    const before = JSON.stringify([...(await memory.writer.loadPriorState('b1')).nodes]);
    const second = await projectBoard(doc, 'b1', memory.writer);
    const after = JSON.stringify([...(await memory.writer.loadPriorState('b1')).nodes]);

    expect(second).toEqual({ ok: true });
    expect(after).toBe(before);
  });

  it('retries with backoff and eventually succeeds without blocking the snapshot path', async () => {
    const { doc } = fixtureBoard(2, 1);
    const memory = createMemoryProjectionWriter();
    memory.failNextApplyDiff(new Error('transient db error'));

    const sleeps: number[] = [];
    const result = await projectBoard(doc, 'b1', memory.writer, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result).toEqual({ ok: true });
    expect(sleeps).toEqual([1_000]); // first attempt failed, one retry succeeded
    expect(memory.projectedAt).not.toBeNull();
    expect(memory.failed).toBe(false);
  });

  it('exhausting all retries records the failure and never throws', async () => {
    const { doc } = fixtureBoard(1, 0);
    const memory = createMemoryProjectionWriter();
    const alwaysFail = {
      ...memory.writer,
      applyDiff: vi.fn().mockRejectedValue(new Error('permanent failure')),
    };

    const result = await projectBoard(doc, 'b1', alwaysFail, {
      sleep: async () => undefined,
      retry: { delays: [1, 1] },
    });

    expect(result.ok).toBe(false);
    expect(memory.failed).toBe(true);
  });

  it('projects the full board on the first run', async () => {
    const { doc, nodeIds } = fixtureBoard(3, 2);
    const memory = createMemoryProjectionWriter();
    await projectBoard(doc, 'b1', memory.writer);
    expect(memory.store.nodes.size).toBe(3);
    expect(nodeIds).toHaveLength(3);
  });
});
