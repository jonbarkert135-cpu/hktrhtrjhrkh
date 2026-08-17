import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';

import { createBoardDoc, emptyBoardDoc } from '../src/doc/createBoardDoc.ts';
import { observeBoard, type BoardChange } from '../src/doc/observers.ts';
import {
  addEdges,
  addGroup,
  addNodes,
  moveNodes,
  removeNodes,
  reorder,
  updateNode,
} from '../src/doc/mutations.ts';
import { boardRoots } from '../src/doc/schema.ts';
import { makeEdge } from '../src/entities/edge.ts';
import { makeGroup } from '../src/entities/group.ts';
import { T0, fixtureNode } from './doc-fixtures.ts';

const local = { origin: 'local:create', now: T0 } as const;

function recorder(doc: Y.Doc) {
  const changes: BoardChange[] = [];
  const off = observeBoard(doc, (change) => changes.push(change));
  return { changes, off };
}

describe('board observers', () => {
  it('emits one change per transaction with the changed ids', () => {
    const doc = createBoardDoc({ boardId: 'b_obs', now: T0 });
    const { changes, off } = recorder(doc);

    addNodes(doc, [fixtureNode('n1', 0), fixtureNode('n2', 1)], local);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.nodes.upserted).toEqual(['n1', 'n2']);
    expect(changes[0]?.orderChanged).toBe(true);
    expect(changes[0]?.origin).toBe('local:create');
    expect(changes[0]?.remote).toBe(false);

    moveNodes(doc, [{ id: 'n1', x: 10, y: 10 }], { origin: 'local:move', now: T0 });
    expect(changes[1]?.nodes.upserted).toEqual(['n1']);
    expect(changes[1]?.nodes.removed).toEqual([]);

    off();
  });

  it('reports nested field edits as an upsert of the owning record', () => {
    const doc = createBoardDoc({ boardId: 'b_nested', now: T0 });
    addNodes(doc, [fixtureNode('n1', 0)], local);
    const { changes, off } = recorder(doc);
    updateNode(doc, 'n1', { title: 'renamed' }, { origin: 'local:edit', now: T0 });
    expect(changes[0]?.nodes.upserted).toEqual(['n1']);
    off();
  });

  it('reports removals and drops them from the upsert list', () => {
    const doc = createBoardDoc({ boardId: 'b_rm', now: T0 });
    addNodes(doc, [fixtureNode('n1', 0), fixtureNode('n2', 1)], local);
    addEdges(doc, [makeEdge({ id: 'e1', from: 'n1', to: 'n2' }, T0)], local);
    const { changes, off } = recorder(doc);

    removeNodes(doc, ['n1'], { origin: 'local:delete', now: T0 });
    expect(changes[0]?.nodes.removed).toEqual(['n1']);
    expect(changes[0]?.nodes.upserted).toEqual([]);
    expect(changes[0]?.edges.removed).toEqual(['e1']);
    off();
  });

  it('tracks groups, order and meta separately', () => {
    const doc = createBoardDoc({ boardId: 'b_meta', now: T0 });
    addNodes(doc, [fixtureNode('n1', 0)], local);
    const { changes, off } = recorder(doc);

    addGroup(doc, makeGroup({ id: 'g1', x: 0, y: 0, w: 10, h: 10 }, T0), local);
    expect(changes[0]?.groups.upserted).toEqual(['g1']);
    expect(changes[0]?.metaChanged).toBe(true);

    reorder(doc, ['n1'], 'front', { origin: 'local:layout', now: T0 });
    expect(changes[1]?.orderChanged).toBe(true);
    off();
  });

  it('marks updates from another replica as remote', () => {
    const mine = createBoardDoc({ boardId: 'b_remote', now: T0 });
    const theirs = emptyBoardDoc('b_remote');
    Y.applyUpdate(theirs, Y.encodeStateAsUpdate(mine), 'remote:sync');
    const { changes, off } = recorder(mine);

    addNodes(theirs, [fixtureNode('n_remote', 0)], local);
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(theirs), 'remote:sync');

    expect(changes[0]?.remote).toBe(true);
    expect(changes[0]?.origin).toBe('remote:sync');
    off();
  });

  it('stays silent for transactions that change nothing and after unsubscribe', () => {
    const doc = createBoardDoc({ boardId: 'b_quiet', now: T0 });
    const listener = vi.fn();
    const off = observeBoard(doc, listener);

    doc.transact(() => boardRoots(doc).comments.set('c1', new Y.Map()), 'local:edit');
    expect(listener).not.toHaveBeenCalled();

    off();
    off(); // idempotent
    addNodes(doc, [fixtureNode('n1', 0)], local);
    expect(listener).not.toHaveBeenCalled();
  });
});
