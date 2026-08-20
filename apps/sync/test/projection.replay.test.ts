/**
 * P8 §11: `apps/sync/test/projection.replay.test.ts` — `scripts/reproject.ts`'s algorithm (wipe the
 * projection for a board, replay from the snapshot bytes) reproduces the same rows the live,
 * incremental path produced (08_DATA_MODEL.md §5.5).
 */

import * as Y from 'yjs';
import {
  applyProjectionDiff,
  diffBoardDoc,
  emptyProjectionState,
  MemoryProjectionStore,
  updateNode,
} from '@nexus/domain';
import { describe, expect, it } from 'vitest';

import { projectBoard } from '../src/projection.ts';
import { createMemoryProjectionWriter } from './support/memoryWriter.ts';
import { fixtureBoard, T0 } from './support/fixtureBoard.ts';

function snapshot(store: MemoryProjectionStore) {
  return {
    nodes: [...store.nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...store.edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

describe('reproject replay', () => {
  it('rebuilding from the encoded snapshot bytes reproduces the live-projected rows', async () => {
    const { doc, nodeIds } = fixtureBoard(5, 4);
    updateNode(doc, nodeIds[0] ?? '', { title: 'edited live' }, { origin: 'local:edit', now: T0 });

    const live = createMemoryProjectionWriter();
    await projectBoard(doc, 'b1', live.writer);

    // `scripts/reproject.ts`: decode the snapshot into a fresh doc, project from scratch.
    const bytes = Y.encodeStateAsUpdateV2(doc);
    const replayDoc = new Y.Doc();
    Y.applyUpdateV2(replayDoc, bytes);

    const replayed = new MemoryProjectionStore();
    const diff = diffBoardDoc(replayDoc, emptyProjectionState());
    applyProjectionDiff(replayed, diff);

    expect(snapshot(replayed)).toEqual(snapshot(live.store));
  });

  it('replay is deterministic across repeated runs', () => {
    const { doc } = fixtureBoard(6, 5);
    const bytes = Y.encodeStateAsUpdateV2(doc);

    const runOnce = () => {
      const replayDoc = new Y.Doc();
      Y.applyUpdateV2(replayDoc, bytes);
      const store = new MemoryProjectionStore();
      applyProjectionDiff(store, diffBoardDoc(replayDoc, emptyProjectionState()));
      return snapshot(store);
    };

    expect(runOnce()).toEqual(runOnce());
  });
});
