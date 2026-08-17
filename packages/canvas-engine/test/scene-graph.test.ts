/**
 * Scene graph behaviour: every `ScenePatch` op, incremental `sceneBounds`, `edgesByNode`
 * invalidation, hidden/locked and layer-visibility filtering, and the 0 / 1 / 5,000-node scenes
 * from roadmap P2 §8.
 */

import { describe, expect, it } from 'vitest';
import { createSceneGraph } from '../src/scene/graph';
import type {
  EdgeView,
  GroupView,
  LayerView,
  NodeView,
  SceneSnapshot,
  ScenePatch,
} from '../src/types';
import { MIN_NODE_SIZE } from '../src/constants';

const LAYER: LayerView = { id: 'l1', name: 'Main', visible: true, locked: false };

function node(id: string, over: Partial<NodeView> = {}): NodeView {
  return {
    id,
    kind: 'note',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    z: 0,
    layerId: LAYER.id,
    groupId: null,
    rotation: 0,
    locked: false,
    hidden: false,
    glyph: {
      accent: { r: 0, g: 0, b: 0, a: 1 },
      fill: { r: 0, g: 0, b: 0, a: 1 },
      icon: 'note',
      title: id,
      badgeCount: 0,
      thumbnailKey: null,
      status: 'none',
    },
    domKey: id,
    visualVersion: 1,
    ...over,
  };
}

function edge(id: string, from: string, to: string): EdgeView {
  return {
    id,
    from,
    to,
    fromAnchor: { side: 'auto', t: 0.5 },
    toAnchor: { side: 'auto', t: 0.5 },
    routing: 'straight',
    style: {
      color: { r: 0, g: 0, b: 0, a: 1 },
      width: 1,
      dash: null,
      arrowStart: false,
      arrowEnd: true,
      opacity: 1,
    },
    label: null,
    z: 0,
    hidden: false,
    visualVersion: 1,
  };
}

const group = (id: string): GroupView => ({
  id,
  title: id,
  color: { r: 0, g: 0, b: 0, a: 1 },
  collapsed: false,
  z: 0,
});

function snapshot(over: Partial<SceneSnapshot> = {}): SceneSnapshot {
  return { nodes: [], edges: [], groups: [], layers: [LAYER], ...over };
}

const ids = (list: readonly NodeView[]): string[] => list.map((n) => n.id);

describe('scene graph construction', () => {
  it('handles an empty scene', () => {
    const g = createSceneGraph(snapshot());
    expect(g.query.nodeCount).toBe(0);
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(g.query.nodesIn({ x: -1e6, y: -1e6, w: 2e6, h: 2e6 })).toEqual([]);
    expect(g.query.nodeAt({ x: 0, y: 0 })).toBeNull();
    expect(g.query.node('nope')).toBeUndefined();
    expect(g.query.edge('nope')).toBeUndefined();
  });

  it('handles a single node', () => {
    const g = createSceneGraph(snapshot({ nodes: [node('a', { x: 10, y: 20 })] }));
    expect(g.query.nodeCount).toBe(1);
    expect(g.query.sceneBounds).toEqual({ x: 10, y: 20, w: 100, h: 100 });
    expect(g.query.nodeAt({ x: 15, y: 25 })?.id).toBe('a');
    expect(g.query.nodeAt({ x: 300, y: 300 })).toBeNull();
    expect(g.byLayer.get(LAYER.id)).toEqual(['a']);
  });

  it('handles 5,000 nodes stacked at one coordinate', () => {
    const nodes = Array.from({ length: 5000 }, (_, i) => node(`n${i}`, { z: i }));
    const g = createSceneGraph(snapshot({ nodes }));
    expect(g.query.nodeCount).toBe(5000);
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    // Topmost-first hit test picks the largest z.
    expect(g.query.nodeAt({ x: 50, y: 50 })?.id).toBe('n4999');
    expect(g.query.nodesIn({ x: 0, y: 0, w: 1, h: 1 })).toHaveLength(5000);
  });

  it('orders nodes bottom→top by layer then z, and marks the first frame dirty', () => {
    const layers: LayerView[] = [LAYER, { id: 'l2', name: 'Top', visible: true, locked: false }];
    const g = createSceneGraph(
      snapshot({
        layers,
        nodes: [node('a', { z: 5 }), node('b', { z: 1 }), node('c', { layerId: 'l2', z: 0 })],
      }),
    );
    expect(ids(g.query.nodesIn({ x: 0, y: 0, w: 100, h: 100 }))).toEqual(['b', 'a', 'c']);
    expect(g.dirty.full).toBe(true);
    g.clearDirty();
    expect(g.dirty.full).toBe(false);
    expect(g.dirty.nodes.size).toBe(0);
    expect(g.dirty.rects).toEqual([]);
  });
});

describe('patch operations', () => {
  it('upserts, moves, resizes and removes a node', () => {
    const g = createSceneGraph(snapshot());
    g.applyPatch({ op: 'upsert-node', node: node('a', { x: 0, y: 0 }) });
    expect(g.query.nodeCount).toBe(1);

    g.applyPatch({ op: 'move-nodes', moves: [{ id: 'a', x: 50, y: 60 }] });
    expect(g.query.node('a')).toMatchObject({ x: 50, y: 60 });
    expect(g.query.sceneBounds).toEqual({ x: 50, y: 60, w: 100, h: 100 });

    g.applyPatch({ op: 'resize-node', id: 'a', w: 200, h: 220 });
    expect(g.query.sceneBounds).toEqual({ x: 50, y: 60, w: 200, h: 220 });
    g.applyPatch({ op: 'resize-node', id: 'a', w: 200, h: 220, x: 0, y: 0 });
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 200, h: 220 });

    g.applyPatch({ op: 'remove-node', id: 'a' });
    expect(g.query.nodeCount).toBe(0);
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('replaces a node on re-upsert without leaving stale index or layer entries', () => {
    const g = createSceneGraph(snapshot({ nodes: [node('a')] }));
    g.applyPatch({ op: 'upsert-node', node: node('a', { x: 900, y: 900, z: 3 }) });
    expect(g.byLayer.get(LAYER.id)).toEqual(['a']);
    expect(g.query.nodesIn({ x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
    expect(ids(g.query.nodesIn({ x: 900, y: 900, w: 10, h: 10 }))).toEqual(['a']);
  });

  it('ignores moves and resizes of unknown nodes and no-op moves', () => {
    const g = createSceneGraph(snapshot({ nodes: [node('a')] }));
    g.clearDirty();
    g.applyPatch({ op: 'move-nodes', moves: [{ id: 'ghost', x: 1, y: 1 }] });
    g.applyPatch({ op: 'move-nodes', moves: [{ id: 'a', x: 0, y: 0 }] });
    g.applyPatch({ op: 'resize-node', id: 'ghost', w: 10, h: 10 });
    g.applyPatch({ op: 'remove-node', id: 'ghost' });
    expect(g.dirty.nodes.size).toBe(0);
  });

  it('maintains edgesByNode and invalidates incident edges on move', () => {
    const g = createSceneGraph(
      snapshot({
        nodes: [node('a'), node('b', { x: 400 })],
        edges: [edge('e1', 'a', 'b')],
      }),
    );
    expect([...(g.edgesByNode.get('a') ?? [])]).toEqual(['e1']);
    g.clearDirty();
    g.applyPatch({ op: 'move-nodes', moves: [{ id: 'a', x: 10, y: 10 }] });
    expect([...g.dirty.edges]).toEqual(['e1']);

    // Re-pointing an edge unlinks the old endpoint.
    g.applyPatch({ op: 'upsert-edge', edge: edge('e1', 'b', 'b') });
    expect(g.edgesByNode.get('a')).toBeUndefined();
    expect([...(g.edgesByNode.get('b') ?? [])]).toEqual(['e1']);

    g.applyPatch({ op: 'remove-edge', id: 'e1' });
    expect(g.edgesByNode.size).toBe(0);
    expect(g.query.edge('e1')).toBeUndefined();
    g.applyPatch({ op: 'remove-edge', id: 'e1' });
    expect(g.edges.size).toBe(0);
  });

  it('drops edges incident to a removed node', () => {
    const g = createSceneGraph(
      snapshot({
        nodes: [node('a'), node('b', { x: 400 })],
        edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')],
      }),
    );
    g.applyPatch({ op: 'remove-node', id: 'a' });
    expect(g.edges.size).toBe(0);
    expect(g.edgesByNode.size).toBe(0);
  });

  it('maintains group membership and lazily recomputed group bounds', () => {
    const g = createSceneGraph(
      snapshot({
        groups: [group('g1')],
        nodes: [node('a', { groupId: 'g1' }), node('b', { x: 400, groupId: 'g1' }), node('c')],
      }),
    );
    expect([...(g.groupChildren.get('g1') ?? [])]).toEqual(['a', 'b']);
    expect(g.groupBounds('g1')).toEqual({ x: 0, y: 0, w: 500, h: 100 });
    // Second read is served from the cache and must be equal but not aliased.
    const first = g.groupBounds('g1');
    expect(g.groupBounds('g1')).toEqual(first);
    expect(g.groupBounds('missing')).toBeNull();

    g.applyPatch({ op: 'move-nodes', moves: [{ id: 'b', x: 900, y: 0 }] });
    expect(g.groupBounds('g1')).toEqual({ x: 0, y: 0, w: 1000, h: 100 });

    g.applyPatch({ op: 'upsert-group', group: group('g2') });
    expect(g.groups.has('g2')).toBe(true);
    g.applyPatch({ op: 'remove-group', id: 'g1' });
    expect(g.query.node('a')?.groupId).toBeNull();
    expect(g.groupChildren.get('g1')).toBeUndefined();
    expect(g.groupBounds('g1')).toBeNull();
    g.applyPatch({ op: 'remove-group', id: 'g1' });
    expect(g.groups.has('g1')).toBe(false);

    g.applyPatch({ op: 'remove-node', id: 'c' });
    expect(g.query.nodeCount).toBe(2);
  });

  it('applies set-layers: order, visibility and re-indexing', () => {
    const l2: LayerView = { id: 'l2', name: 'Second', visible: true, locked: false };
    const g = createSceneGraph(
      snapshot({
        layers: [LAYER, l2],
        nodes: [node('a'), node('b', { layerId: 'l2' })],
      }),
    );
    expect(ids(g.query.nodesIn({ x: 0, y: 0, w: 100, h: 100 }))).toEqual(['a', 'b']);

    g.applyPatch({ op: 'set-layers', layers: [l2, LAYER] });
    expect(ids(g.query.nodesIn({ x: 0, y: 0, w: 100, h: 100 }))).toEqual(['b', 'a']);
    expect(g.layers.map((l) => l.id)).toEqual(['l2', 'l1']);
    expect(g.dirty.full).toBe(true);

    g.applyPatch({ op: 'set-layers', layers: [{ ...l2, visible: false }, LAYER] });
    expect(ids(g.query.nodesIn({ x: 0, y: 0, w: 100, h: 100 }))).toEqual(['a']);
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(g.query.nodeCount).toBe(2);

    g.applyPatch({ op: 'set-layers', layers: [l2, LAYER] });
    expect(ids(g.query.nodesIn({ x: 0, y: 0, w: 100, h: 100 }))).toEqual(['b', 'a']);
  });

  it('applies a bulk patch atomically: an invalid member rejects the whole batch', () => {
    const g = createSceneGraph(snapshot({ nodes: [node('a')] }));
    const bad: ScenePatch = {
      op: 'bulk',
      patches: [
        { op: 'upsert-node', node: node('b', { x: 300 }) },
        { op: 'move-nodes', moves: [{ id: 'a', x: Number.NaN, y: 0 }] },
      ],
    };
    expect(() => g.applyPatch(bad)).toThrow(RangeError);
    expect(g.query.nodeCount).toBe(1);
    expect(g.query.node('a')).toMatchObject({ x: 0, y: 0 });

    g.applyPatch({
      op: 'bulk',
      patches: [
        { op: 'upsert-node', node: node('b', { x: 300 }) },
        { op: 'upsert-edge', edge: edge('e1', 'a', 'b') },
        { op: 'move-nodes', moves: [{ id: 'a', x: 20, y: 20 }] },
      ],
    });
    expect(g.query.nodeCount).toBe(2);
    expect(g.edges.size).toBe(1);
  });

  it('rejects structurally invalid patches', () => {
    const g = createSceneGraph(snapshot({ nodes: [node('a')] }));
    expect(() => g.applyPatch({ op: 'upsert-node', node: node('') })).toThrow(RangeError);
    expect(() =>
      g.applyPatch({ op: 'upsert-node', node: node('x', { x: Number.POSITIVE_INFINITY }) }),
    ).toThrow(RangeError);
    expect(() => g.applyPatch({ op: 'resize-node', id: 'a', w: Number.NaN, h: 1 })).toThrow(
      RangeError,
    );
    expect(() =>
      g.applyPatch({ op: 'resize-node', id: 'a', w: 1, h: 1, x: Number.NaN, y: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      g.applyPatch({ op: 'resize-node', id: 'a', w: 1, h: 1, x: 0, y: Number.NaN }),
    ).toThrow(RangeError);
    expect(() => g.applyPatch({ op: 'upsert-edge', edge: { ...edge('', 'a', 'a') } })).toThrow(
      RangeError,
    );
    expect(() =>
      g.applyPatch({ op: 'upsert-edge', edge: { ...edge('e', 'a', 'a'), z: Number.NaN } }),
    ).toThrow(RangeError);
    expect(() => g.applyPatch({ op: 'set-layers', layers: [LAYER, LAYER] })).toThrow(RangeError);
  });
});

describe('sceneBounds maintenance', () => {
  it('recomputes when the node that touched the bound is removed', () => {
    const g = createSceneGraph(
      snapshot({
        nodes: [node('a', { x: 0, y: 0 }), node('b', { x: 500, y: 500 }), node('c', { x: 200 })],
      }),
    );
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 600, h: 600 });
    g.applyPatch({ op: 'remove-node', id: 'b' });
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 300, h: 100 });
    g.applyPatch({ op: 'remove-node', id: 'c' });
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    g.applyPatch({ op: 'remove-node', id: 'a' });
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('shrinks when the extreme node moves inward and grows on outward moves', () => {
    const g = createSceneGraph(
      snapshot({ nodes: [node('a', { x: 0, y: 0 }), node('b', { x: 800, y: 0 })] }),
    );
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 900, h: 100 });
    g.applyPatch({ op: 'move-nodes', moves: [{ id: 'b', x: 300, y: 0 }] });
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 400, h: 100 });
    g.applyPatch({ op: 'move-nodes', moves: [{ id: 'b', x: 0, y: 700 }] });
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 100, h: 800 });
  });

  it('survives extreme coordinates', () => {
    const g = createSceneGraph(
      snapshot({ nodes: [node('a', { x: -1e7, y: -1e7 }), node('b', { x: 1e7, y: 1e7 })] }),
    );
    expect(g.query.sceneBounds).toEqual({ x: -1e7, y: -1e7, w: 2e7 + 100, h: 2e7 + 100 });
    expect(ids(g.query.nodesIn({ x: 1e7, y: 1e7, w: 1, h: 1 }))).toEqual(['b']);
  });
});

describe('query filtering', () => {
  it('excludes hidden nodes from every query but keeps them addressable by id', () => {
    const g = createSceneGraph(
      snapshot({ nodes: [node('a'), node('hidden', { hidden: true, x: 10 })] }),
    );
    expect(ids(g.query.nodesIn({ x: 0, y: 0, w: 200, h: 200 }))).toEqual(['a']);
    expect(g.query.nodeAt({ x: 50, y: 50 })?.id).toBe('a');
    expect(g.query.node('hidden')).toBeDefined();
    expect(g.query.sceneBounds).toEqual({ x: 0, y: 0, w: 100, h: 100 });

    // Un-hiding through an upsert brings it back into the index.
    g.applyPatch({ op: 'upsert-node', node: node('hidden', { x: 10, z: 9 }) });
    expect(ids(g.query.nodesIn({ x: 0, y: 0, w: 200, h: 200 }))).toEqual(['a', 'hidden']);
  });

  it('drops a node out of the index when a move also hides it', () => {
    const g = createSceneGraph(snapshot({ nodes: [node('a'), node('b', { x: 400 })] }));
    g.applyPatch({ op: 'upsert-node', node: node('a', { hidden: true }) });
    g.applyPatch({ op: 'move-nodes', moves: [{ id: 'a', x: 50, y: 50 }] });
    expect(g.query.nodesIn({ x: 0, y: 0, w: 200, h: 200 })).toEqual([]);
    expect(g.query.sceneBounds).toEqual({ x: 400, y: 0, w: 100, h: 100 });
  });

  it('keeps locked nodes hit-testable', () => {
    const g = createSceneGraph(snapshot({ nodes: [node('a', { locked: true })] }));
    expect(g.query.nodeAt({ x: 10, y: 10 })?.id).toBe('a');
    expect(ids(g.query.nodesIn({ x: 0, y: 0, w: 10, h: 10 }))).toEqual(['a']);
  });

  it('treats an unknown layerId as unrestricted and paints it on top', () => {
    const g = createSceneGraph(snapshot({ nodes: [node('a'), node('x', { layerId: 'nope' })] }));
    expect(ids(g.query.nodesIn({ x: 0, y: 0, w: 100, h: 100 }))).toEqual(['a', 'x']);
  });

  it('returns only fully contained nodes for the alt marquee mode', () => {
    const g = createSceneGraph(
      snapshot({ nodes: [node('inside', { x: 10, y: 10 }), node('crossing', { x: 150, y: 10 })] }),
    );
    const rect = { x: 0, y: 0, w: 200, h: 200 };
    // Equal z ⇒ id order, which is what keeps the render order deterministic.
    expect(ids(g.query.nodesIn(rect))).toEqual(['crossing', 'inside']);
    expect(ids(g.query.nodesContainedIn(rect))).toEqual(['inside']);
  });

  it('reports degenerate sizes once through the injected hook', () => {
    const seen: string[] = [];
    const g = createSceneGraph(
      snapshot({ nodes: [node('a', { w: 0, h: 0 }), node('b', { x: 300, w: -5, h: -5 })] }),
      { onDegenerateRect: (id) => seen.push(String(id)) },
    );
    expect(seen).toEqual(['a']);
    expect(g.index.rectOf('a')).toEqual({ x: 0, y: 0, w: MIN_NODE_SIZE, h: MIN_NODE_SIZE });
  });

  it('does not mutate the NodeView objects handed to it', () => {
    const original = node('a');
    const g = createSceneGraph(snapshot({ nodes: [original] }));
    g.applyPatch({ op: 'move-nodes', moves: [{ id: 'a', x: 77, y: 88 }] });
    expect(original.x).toBe(0);
    expect(g.query.node('a')?.x).toBe(77);
  });
});
