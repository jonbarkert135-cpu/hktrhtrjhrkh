/**
 * CRDT convergence (18_TESTING.md §4.1–4.2): two replicas that apply the same operations in any
 * interleaving must converge to the same document, and a merge must never leave a dangling edge.
 * No server is involved — updates are exchanged directly, which is exactly the offline case (N2).
 */

import fc from 'fast-check';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { createBoardDoc, emptyBoardDoc } from '../src/doc/createBoardDoc.ts';
import { checkGraphInvariants } from '../src/doc/invariants.ts';
import {
  addNodes,
  listNodes,
  moveNodes,
  pruneDanglingEdges,
  removeNodes,
  addEdges,
  updateNode,
} from '../src/doc/mutations.ts';
import { makeEdge } from '../src/entities/edge.ts';
import { makeNode } from '../src/entities/node.ts';
import { T0 } from './doc-fixtures.ts';

type Op =
  | { kind: 'add'; id: string }
  | { kind: 'move'; index: number }
  | { kind: 'rename'; index: number }
  | { kind: 'remove'; index: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant<'add'>('add'), id: fc.hexaString({ minLength: 4, maxLength: 6 }) }),
  fc.record({ kind: fc.constant<'move'>('move'), index: fc.integer({ min: 0, max: 5 }) }),
  fc.record({ kind: fc.constant<'rename'>('rename'), index: fc.integer({ min: 0, max: 5 }) }),
  fc.record({ kind: fc.constant<'remove'>('remove'), index: fc.integer({ min: 0, max: 5 }) }),
);

function apply(doc: Y.Doc, op: Op, replica: string): void {
  const ids = listNodes(doc).map((node) => node.id);
  if (op.kind === 'add') {
    addNodes(doc, [makeNode({ id: `${replica}_${op.id}`, x: 0, y: 0, title: op.id }, T0)], {
      origin: 'local:create',
      now: T0,
    });
    return;
  }
  const id = ids[op.index % Math.max(ids.length, 1)];
  if (id === undefined) return;
  if (op.kind === 'move')
    moveNodes(doc, [{ id, x: op.index * 10, y: 5 }], { origin: 'local:move', now: T0 });
  else if (op.kind === 'rename')
    updateNode(
      doc,
      id,
      { title: `${replica}-${String(op.index)}` },
      { origin: 'local:edit', now: T0 },
    );
  else removeNodes(doc, [id], { origin: 'local:delete', now: T0 });
}

function sync(a: Y.Doc, b: Y.Doc): void {
  const updateA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const updateB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, updateA, 'remote:sync');
  Y.applyUpdate(a, updateB, 'remote:sync');
}

describe('board document convergence', () => {
  it('converges for any interleaving of concurrent edits', () => {
    fc.assert(
      fc.property(
        fc.array(opArb, { maxLength: 12 }),
        fc.array(opArb, { maxLength: 12 }),
        (opsA, opsB) => {
          const base = createBoardDoc({ boardId: 'b_conv', now: T0 });
          addNodes(
            base,
            [0, 1, 2].map((i) => makeNode({ id: `seed_${String(i)}`, x: i, y: i }, T0)),
            { origin: 'local:create', now: T0 },
          );
          const replicaA = base;
          const replicaB = emptyBoardDoc('b_conv');
          Y.applyUpdate(replicaB, Y.encodeStateAsUpdate(replicaA), 'remote:sync');

          for (const op of opsA) apply(replicaA, op, 'a');
          for (const op of opsB) apply(replicaB, op, 'b');
          sync(replicaA, replicaB);

          expect(replicaB.getMap('nodes').toJSON()).toEqual(replicaA.getMap('nodes').toJSON());
          expect(replicaB.getMap('edges').toJSON()).toEqual(replicaA.getMap('edges').toJSON());
        },
      ),
      { numRuns: 30 },
    );
  });

  it('prunes edges left dangling by a concurrent delete', () => {
    const a = createBoardDoc({ boardId: 'b_dangle', now: T0 });
    addNodes(a, [makeNode({ id: 'n1', x: 0, y: 0 }, T0), makeNode({ id: 'n2', x: 10, y: 0 }, T0)], {
      origin: 'local:create',
      now: T0,
    });
    const b = emptyBoardDoc('b_dangle');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'remote:sync');

    // A connects the two nodes while B deletes one of them.
    addEdges(a, [makeEdge({ id: 'e1', from: 'n1', to: 'n2' }, T0)], {
      origin: 'local:create',
      now: T0,
    });
    removeNodes(b, ['n2'], { origin: 'local:delete', now: T0 });
    sync(a, b);

    expect(checkGraphInvariants(a).some((v) => v.code === 'dangling-edge')).toBe(true);
    expect(pruneDanglingEdges(a)).toEqual(['e1']);
    sync(a, b);
    expect(checkGraphInvariants(a)).toEqual([]);
    expect(checkGraphInvariants(b)).toEqual([]);
  });

  it('keeps two tabs of the same browser consistent without a server', () => {
    const tab1 = createBoardDoc({ boardId: 'b_tabs', now: T0 });
    const tab2 = emptyBoardDoc('b_tabs');
    // A second tab first loads the persisted state, then follows the live update stream.
    Y.applyUpdate(tab2, Y.encodeStateAsUpdate(tab1), 'remote:sync');
    // y-indexeddb exchanges updates as opaque byte arrays; this is that channel, in-memory.
    const relay = (from: Y.Doc, to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
      // Never echo an update back to its sender; that is exactly what y-indexeddb does.
      if (origin !== 'remote:sync') Y.applyUpdate(to, update, 'remote:sync');
      expect(from).not.toBe(to);
    };
    tab1.on('update', relay(tab1, tab2));
    tab2.on('update', relay(tab2, tab1));

    addNodes(tab1, [makeNode({ id: 'n1', x: 0, y: 0, title: 'from tab 1' }, T0)], {
      origin: 'local:create',
      now: T0,
    });
    updateNode(tab2, 'n1', { title: 'renamed in tab 2' }, { origin: 'local:edit', now: T0 });

    expect(listNodes(tab1)[0]?.title).toBe('renamed in tab 2');
    expect(listNodes(tab2)[0]?.title).toBe('renamed in tab 2');
  });
});
