/**
 * P8 §11: `packages/domain/test/projection.diff.test.ts` — the property that both the sync
 * service's incremental path and `scripts/reproject.ts` depend on: applying the diff produced by
 * `diffBoardDoc` to a store, chained update after update, always equals a full re-projection of
 * the document from scratch.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addNodes, removeNodes, updateNode } from '../src/doc/mutations.ts';
import {
  MemoryProjectionStore,
  applyProjectionDiff,
  diffBoardDoc,
  emptyProjectionState,
  fullProject,
  isNewer,
  type PriorProjectionState,
} from '../src/projection/index.ts';
import { T0, fixtureBoard, fixtureNode } from './doc-fixtures.ts';

function snapshot(store: MemoryProjectionStore) {
  return {
    nodes: [...store.nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...store.edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

describe('diffBoardDoc / applyProjectionDiff', () => {
  it('an incremental replay from an empty state equals a full projection', () => {
    const { doc } = fixtureBoard(5, 4);

    const incremental = new MemoryProjectionStore();
    const diff = diffBoardDoc(doc, emptyProjectionState());
    applyProjectionDiff(incremental, diff);

    const full = new MemoryProjectionStore();
    fullProject(doc, full);

    expect(snapshot(incremental)).toEqual(snapshot(full));
  });

  it('is idempotent: re-running the same diff against the same prior state changes nothing', () => {
    const { doc } = fixtureBoard(4, 3);
    let state: PriorProjectionState = emptyProjectionState();
    const store = new MemoryProjectionStore();

    const first = diffBoardDoc(doc, state);
    applyProjectionDiff(store, first);
    state = store.toProjectionState();

    const second = diffBoardDoc(doc, state);
    expect(second.upsertNodes).toHaveLength(0);
    expect(second.upsertEdges).toHaveLength(0);
    expect(second.deleteNodeIds).toHaveLength(0);
    expect(second.deleteEdgeIds).toHaveLength(0);
  });

  it('deletions in the doc project as deletions of the row', () => {
    const { doc, nodeIds } = fixtureBoard(3, 0);
    const store = new MemoryProjectionStore();
    fullProject(doc, store);
    expect(store.nodes.has(nodeIds[0] ?? '')).toBe(true);

    removeNodes(doc, [nodeIds[0] ?? ''], { origin: 'local:delete', now: T0 });
    const diff = diffBoardDoc(doc, store.toProjectionState());
    applyProjectionDiff(store, diff);

    expect(store.nodes.has(nodeIds[0] ?? '')).toBe(false);
  });

  it('a version bump is required to move a row forward (out-of-order retries never regress it)', () => {
    const older = { id: 'n1', version: 2, updatedAt: '2026-01-02T00:00:00.000Z' };
    expect(isNewer(older, { version: 2, updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
    expect(isNewer(older, { version: 3, updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(true);
    expect(isNewer(older, { version: 2, updatedAt: '2026-01-03T00:00:00.000Z' })).toBe(true);
    expect(isNewer(undefined, { version: 1, updatedAt: T0 })).toBe(true);
  });

  it('property: incremental application after any sequence of node ops equals a full projection', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<'add' | 'update' | 'remove'>('add', 'update', 'remove'), {
          minLength: 1,
          maxLength: 12,
        }),
        (ops) => {
          const { doc, nodeIds } = fixtureBoard(3, 2);
          let store = new MemoryProjectionStore();
          fullProject(doc, store);
          let state = store.toProjectionState();

          let counter = 0;
          for (const op of ops) {
            if (op === 'add') {
              counter += 1;
              const id = `extra_${String(counter)}`;
              const node = fixtureNode(id, counter);
              addNodes(doc, [node], { origin: 'local:create', now: T0 });
            } else if (op === 'update' && nodeIds.length > 0) {
              updateNode(
                doc,
                nodeIds[0] ?? '',
                { title: `renamed ${String(counter)}` },
                {
                  origin: 'local:edit',
                  now: T0,
                },
              );
            } else if (op === 'remove' && nodeIds.length > 1) {
              removeNodes(doc, [nodeIds.pop() ?? ''], { origin: 'local:delete', now: T0 });
            }

            const diff = diffBoardDoc(doc, state);
            applyProjectionDiff(store, diff);
            state = store.toProjectionState();
          }

          const full = new MemoryProjectionStore();
          fullProject(doc, full);
          expect(snapshot(store)).toEqual(snapshot(full));
        },
      ),
      { numRuns: 25 },
    );
  });
});
