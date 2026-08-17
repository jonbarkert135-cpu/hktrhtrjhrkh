import { describe, expect, it } from 'vitest';

import { createBoardDoc, readMeta } from '../src/doc/createBoardDoc.ts';
import {
  DocLimitError,
  addEdge,
  addNode,
  addNodes,
  assertCanCreateNodes,
  ensureFragment,
  getNode,
  listEdges,
  listGroups,
  listNodes,
  moveNodes,
  nodeBudget,
  pruneDanglingEdges,
  removeEdges,
  removeGroup,
  removeNodes,
  reorder,
  repairOrder,
  resizeNode,
  updateEdge,
  updateNode,
  addGroup,
} from '../src/doc/mutations.ts';
import { NODE_HARD_LIMIT, boardRoots } from '../src/doc/schema.ts';
import { makeEdge } from '../src/entities/edge.ts';
import { makeGroup } from '../src/entities/group.ts';
import { makeNode } from '../src/entities/node.ts';
import { T0, fixtureBoard, fixtureNode } from './doc-fixtures.ts';

const opts = { origin: 'local:create', now: T0 } as const;

describe('board document mutations', () => {
  it('creates a document with the eight roots and valid meta', () => {
    const doc = createBoardDoc({ boardId: 'b_1', title: 'Case', now: T0 });
    const roots = boardRoots(doc);
    expect(doc.guid).toBe('board:b_1');
    expect(roots.nodes.size).toBe(0);
    const meta = readMeta(doc);
    expect(meta?.title).toBe('Case');
    expect(meta?.schemaVersion).toBe(1);
  });

  it('returns undefined meta for a document that is not a board', () => {
    const doc = createBoardDoc({ boardId: 'b_1', now: T0 });
    doc.transact(() => boardRoots(doc).meta.delete('boardId'));
    expect(readMeta(doc)).toBeUndefined();
  });

  it('adds nodes, appends them to order and reads them back', () => {
    const { doc, nodeIds } = fixtureBoard(3, 0);
    expect(listNodes(doc).map((node) => node.id)).toEqual(nodeIds);
    expect(boardRoots(doc).order.toArray()).toEqual(nodeIds);
    expect(getNode(doc, nodeIds[0] ?? '')?.title).toBe('Node n_0001');
    expect(getNode(doc, 'missing')).toBeUndefined();
  });

  it('skips records that no longer satisfy the schema when listing', () => {
    const { doc, nodeIds } = fixtureBoard(2, 0);
    doc.transact(() =>
      boardRoots(doc)
        .nodes.get(nodeIds[0] ?? '')
        ?.set('w', 'wide'),
    );
    expect(listNodes(doc)).toHaveLength(1);
    expect(getNode(doc, nodeIds[0] ?? '')).toBeUndefined();
  });

  it('moves nodes in one transaction and bumps version', () => {
    const { doc, nodeIds } = fixtureBoard(2, 0);
    const id = nodeIds[0] ?? '';
    moveNodes(
      doc,
      [
        { id, x: 500, y: 600 },
        { id: 'ghost', x: 1, y: 1 },
      ],
      {
        origin: 'local:move',
        now: T0,
      },
    );
    const node = getNode(doc, id);
    expect([node?.x, node?.y, node?.version]).toEqual([500, 600, 2]);
  });

  it('resizes and patches nodes, and reports unknown ids', () => {
    const { doc, nodeIds } = fixtureBoard(1, 0);
    const id = nodeIds[0] ?? '';
    expect(resizeNode(doc, id, { x: 1, y: 2, w: 320, h: 200 }, opts)).toBe(true);
    expect(updateNode(doc, 'ghost', { title: 'x' }, opts)).toBe(false);
    updateNode(doc, id, { title: 'Renamed', futureField: 42 }, opts);
    const node = getNode(doc, id);
    expect(node?.w).toBe(320);
    expect(node?.title).toBe('Renamed');
    expect((node as Record<string, unknown>).futureField).toBe(42);
  });

  it('removes nodes together with their incident edges', () => {
    const { doc, nodeIds, edgeIds } = fixtureBoard(3, 2);
    expect(listEdges(doc).map((edge) => edge.id)).toEqual(edgeIds);
    removeNodes(doc, [nodeIds[0] ?? ''], { origin: 'local:delete', now: T0 });
    expect(listNodes(doc)).toHaveLength(2);
    expect(listEdges(doc).some((edge) => edge.source.nodeId === nodeIds[0])).toBe(false);
    expect(boardRoots(doc).order.toArray()).not.toContain(nodeIds[0]);
  });

  it('updates and removes edges', () => {
    const { doc, edgeIds } = fixtureBoard(3, 2);
    expect(updateEdge(doc, edgeIds[0] ?? '', { label: 'hosted on' }, opts)).toBe(true);
    expect(updateEdge(doc, 'ghost', { label: 'x' }, opts)).toBe(false);
    expect(listEdges(doc)[0]?.label).toBe('hosted on');
    removeEdges(doc, [edgeIds[0] ?? ''], { origin: 'local:delete', now: T0 });
    expect(listEdges(doc)).toHaveLength(1);
  });

  it('prunes dangling edges left by a merge', () => {
    const { doc, nodeIds } = fixtureBoard(3, 2);
    doc.transact(() => boardRoots(doc).nodes.delete(nodeIds[1] ?? ''));
    const pruned = pruneDanglingEdges(doc);
    expect(pruned.length).toBeGreaterThan(0);
    expect(listEdges(doc).every((edge) => edge.source.nodeId !== nodeIds[1])).toBe(true);
  });

  it('keeps group membership symmetric', () => {
    const { doc, nodeIds } = fixtureBoard(2, 0);
    const group = makeGroup(
      { id: 'g_1', x: 0, y: 0, w: 400, h: 400, label: 'Infra', childIds: [nodeIds[0] ?? ''] },
      T0,
    );
    addGroup(doc, group, opts);
    expect(listGroups(doc)).toHaveLength(1);
    expect(getNode(doc, nodeIds[0] ?? '')?.parentId).toBe('g_1');
    expect(removeGroup(doc, 'g_1', opts)).toBe(true);
    expect(removeGroup(doc, 'g_1', opts)).toBe(false);
    expect(getNode(doc, nodeIds[0] ?? '')?.parentId).toBeNull();
  });

  it('reorders nodes and denormalises z', () => {
    const { doc, nodeIds } = fixtureBoard(3, 0);
    const [first, second, third] = nodeIds as [string, string, string];
    reorder(doc, [first], 'front', opts);
    expect(boardRoots(doc).order.toArray()).toEqual([second, third, first]);
    reorder(doc, [first], 'back', opts);
    expect(boardRoots(doc).order.toArray()).toEqual([first, second, third]);
    reorder(doc, [first], 'forward', opts);
    expect(boardRoots(doc).order.toArray()).toEqual([second, first, third]);
    reorder(doc, [first], 'backward', opts);
    expect(boardRoots(doc).order.toArray()).toEqual([first, second, third]);
    reorder(doc, ['ghost'], 'front', opts);
    expect(getNode(doc, third)?.z).toBe(2);
  });

  it('is a no-op when a reorder cannot move anything', () => {
    const { doc, nodeIds } = fixtureBoard(2, 0);
    const before = boardRoots(doc).order.toArray();
    reorder(doc, [nodeIds[0] ?? ''], 'backward', opts);
    expect(boardRoots(doc).order.toArray()).toEqual(before);
  });

  it('repairs a corrupt order array', () => {
    const { doc, nodeIds } = fixtureBoard(2, 0);
    doc.transact(() => {
      const order = boardRoots(doc).order;
      order.push(['ghost', nodeIds[0] ?? '']);
    });
    repairOrder(doc);
    expect(boardRoots(doc).order.toArray()).toEqual(nodeIds);
  });

  it('creates rich-text fragments idempotently', () => {
    const doc = createBoardDoc({ boardId: 'b_1', now: T0 });
    const first = ensureFragment(doc, 'fk_1', 'local:create');
    const second = ensureFragment(doc, 'fk_1', 'local:create');
    expect(second).toBe(first);
    expect(boardRoots(doc).richtext.size).toBe(1);
  });

  it('guards the board size budget', () => {
    const doc = createBoardDoc({ boardId: 'b_1', now: T0 });
    addNode(doc, fixtureNode('n_1'), opts);
    addEdge(doc, makeEdge({ id: 'e_1', from: 'n_1', to: 'n_1' }, T0), opts);
    expect(nodeBudget(doc)).toEqual({ count: 1, warn: false, blocked: false });
    expect(() => assertCanCreateNodes(doc, NODE_HARD_LIMIT)).toThrow(DocLimitError);
    try {
      // The batch is built by repeating one validated node: `addNodes` checks the budget before it
      // touches the payload, so validating 20 000 distinct nodes would only make the test slow
      // (it timed out at 5 s on CI runners) without testing anything extra.
      const filler = makeNode({ id: 'x0', x: 0, y: 0 }, T0);
      addNodes(doc, new Array<typeof filler>(NODE_HARD_LIMIT).fill(filler), opts);
      expect.unreachable('the hard limit must reject the batch');
    } catch (error) {
      expect((error as DocLimitError).limit).toBe(NODE_HARD_LIMIT);
    }
    expect(listNodes(doc)).toHaveLength(1);
  });
});
