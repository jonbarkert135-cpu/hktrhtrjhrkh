/** Server-side node `data` patch (11_GITHUB.md §3.5): merge semantics, missing node, no snapshot. */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addNode, createBoardDoc, getNode, makeNode } from '@nexus/domain';

import { patchNodeData } from '../src/nodePatch.ts';
import type { SnapshotRecord, SnapshotStore } from '../src/persistence.ts';

const NOW = '2026-02-01T00:00:00.000Z';

function memoryStore(initial: Uint8Array | null): SnapshotStore & { written: SnapshotRecord[] } {
  const written: SnapshotRecord[] = [];
  return {
    written,
    latest: () =>
      Promise.resolve(
        initial === null ? null : { binary: initial, stateVector: new Uint8Array(), seq: 4 },
      ),
    write: (_boardId, record) => {
      written.push(record);
      return Promise.resolve();
    },
  };
}

function boardWithNode(): Uint8Array {
  const doc = createBoardDoc({ boardId: 'board-1', title: 'test', now: NOW });
  const node = makeNode(
    { id: 'n1', type: 'repository', x: 0, y: 0, data: { stars: 1, description: 'old' } },
    NOW,
  );
  addNode(doc, node, { origin: 'local:create', now: NOW });
  return Y.encodeStateAsUpdate(doc);
}

describe('patchNodeData', () => {
  it('merges into the existing payload and stores the next snapshot', async () => {
    const store = memoryStore(boardWithNode());

    const outcome = await patchNodeData(store, {
      boardId: 'board-1',
      nodeId: 'n1',
      data: { stars: 7, forks: 2 },
      now: NOW,
    });

    expect(outcome.patched).toBe(true);
    expect(store.written[0]?.seq).toBe(5);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, store.written[0]?.binary ?? new Uint8Array());
    expect(getNode(doc, 'n1')?.data).toEqual({ stars: 7, forks: 2, description: 'old' });
  });

  it('reports a deleted node instead of failing, and writes nothing', async () => {
    const store = memoryStore(boardWithNode());
    const outcome = await patchNodeData(store, {
      boardId: 'board-1',
      nodeId: 'gone',
      data: { stars: 7 },
      now: NOW,
    });
    expect(outcome).toEqual({ patched: false });
    expect(store.written).toHaveLength(0);
  });

  it('throws when the board has no stored document', async () => {
    await expect(
      patchNodeData(memoryStore(null), { boardId: 'board-1', nodeId: 'n1', data: {}, now: NOW }),
    ).rejects.toThrow(/no stored document/);
  });
});
