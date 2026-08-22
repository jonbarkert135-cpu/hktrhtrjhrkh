import { describe, expect, it } from 'vitest';

import {
  applyScope,
  buildAdjacency,
  components,
  countOverlaps,
  createRng,
  hashString,
  proposeLayout,
  runLayout,
  separate,
  snap,
  spanningForest,
  acyclic,
  rankNodes,
  type LayoutGraph,
  type Placement,
} from '../src/index.ts';
import { edge, node, syntheticGraph } from './factories.ts';

describe('rng', () => {
  it('is reproducible from a seed and different across seeds', () => {
    const a = createRng(7);
    const b = createRng(7);
    const c = createRng(8);
    const draw = (rng: { next: () => number }) => [rng.next(), rng.next(), rng.next()];
    expect(draw(a)).toEqual(draw(b));
    expect(draw(createRng(7))).not.toEqual(draw(c));
  });

  it('stays inside its range', () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i += 1) {
      const value = rng.between(-5, 5);
      expect(value).toBeGreaterThanOrEqual(-5);
      expect(value).toBeLessThan(5);
    }
  });

  it('falls back to the default seed for 0 and hashes strings stably', () => {
    expect(createRng(0).next()).toBe(createRng(0).next());
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('graph helpers', () => {
  const graph: LayoutGraph = {
    nodes: [node('a'), node('b'), node('c'), node('d'), node('lonely')],
    edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('a', 'd')],
  };

  it('finds connected components in input order', () => {
    const view = buildAdjacency(graph);
    expect(components(view)).toEqual([['a', 'b', 'c', 'd'], ['lonely']]);
  });

  it('breaks cycles and ranks by longest path', () => {
    const view = buildAdjacency(graph);
    const dag = acyclic(view);
    const rank = rankNodes(view.ids, dag.out, dag.in);
    expect(rank.get('a')).toBe(0);
    expect(rank.get('b')).toBe(1);
    expect(rank.get('c')).toBe(2);
  });

  it('builds a spanning forest that covers every node exactly once', () => {
    const view = buildAdjacency(graph);
    const dag = acyclic(view);
    const forest = spanningForest(view, dag.out, dag.in);
    const reached = new Set(forest.parent.keys());
    expect(reached.size).toBe(graph.nodes.length);
    expect(forest.roots).toContain('a');
    expect(forest.roots).toContain('lonely');
  });
});

describe('separation', () => {
  const box = (id: string, x: number, y: number, pinned = false): Placement => ({
    id,
    x,
    y,
    w: 100,
    h: 100,
    pinned,
  });

  it('pushes overlapping boxes apart', () => {
    const items = [box('a', 0, 0), box('b', 10, 10), box('c', 20, 5)];
    expect(separate(items, 0)).toBe(0);
    expect(countOverlaps(items, 0)).toBe(0);
  });

  it('never moves a pinned box', () => {
    const items = [box('pin', 0, 0, true), box('b', 10, 10)];
    separate(items, 0);
    expect(items[0]).toMatchObject({ x: 0, y: 0 });
    expect(countOverlaps(items, 0)).toBe(0);
  });

  it('is a no-op for fewer than two boxes', () => {
    expect(separate([box('a', 0, 0)], 0)).toBe(0);
    expect(separate([], 0)).toBe(0);
  });

  it('snaps to the grid', () => {
    expect(snap(11)).toBe(8);
    expect(snap(13)).toBe(16);
  });
});

describe('scope', () => {
  const graph = syntheticGraph(20);

  it('passes the whole board through untouched', () => {
    const scoped = applyScope(graph, { kind: 'board' });
    expect(scoped.graph).toBe(graph);
    expect(scoped.excluded).toEqual([]);
  });

  it('keeps only the selection and the edges inside it', () => {
    const ids = ['n0', 'n1', 'n2'];
    const scoped = applyScope(graph, { kind: 'selection', ids });
    expect(scoped.graph.nodes.map((n) => n.id)).toEqual(ids);
    for (const e of scoped.graph.edges) {
      expect(ids).toContain(e.source);
      expect(ids).toContain(e.target);
    }
    expect(scoped.excluded).toHaveLength(17);
  });

  it('grows a subgraph by depth', () => {
    const one = applyScope(graph, { kind: 'subgraph', ids: ['n0'], depth: 1 });
    const two = applyScope(graph, { kind: 'subgraph', ids: ['n0'], depth: 2 });
    expect(one.graph.nodes.length).toBeGreaterThan(1);
    expect(two.graph.nodes.length).toBeGreaterThanOrEqual(one.graph.nodes.length);
    const zero = applyScope(graph, { kind: 'subgraph', ids: ['n0'], depth: 0 });
    expect(zero.graph.nodes.map((n) => n.id)).toEqual(['n0']);
  });

  it('lays out a scoped selection without touching anything else', () => {
    const scoped = applyScope(graph, { kind: 'selection', ids: ['n0', 'n1', 'n2'] });
    const diff = proposeLayout(scoped.graph, { algorithm: 'tree' });
    for (const move of diff.moves) expect(['n0', 'n1', 'n2']).toContain(move.id);
  });
});

describe('performance', () => {
  it('lays out 5,000 nodes / 10,000 edges well inside the 1.5 s budget', () => {
    const graph = syntheticGraph(5000, 2);
    expect(graph.edges.length).toBeGreaterThanOrEqual(9_990);
    const started = performance.now();
    const result = runLayout(graph, { algorithm: 'hierarchical' });
    const elapsed = performance.now() - started;
    expect(result.positions).toHaveLength(5000);
    // The gating number lives in the bench harness (`autolayout-1000`); this is the guard rail
    // that stops an accidental O(n²) from reaching it.
    expect(elapsed).toBeLessThan(4000);
  });
});

describe('option coverage', () => {
  const graph = syntheticGraph(40);

  it('supports every direction for the ranked layouts', () => {
    for (const algorithm of ['hierarchical', 'tree', 'flow'] as const) {
      for (const direction of ['down', 'up', 'right', 'left'] as const) {
        const result = runLayout(graph, { algorithm, direction });
        expect(result.positions).toHaveLength(graph.nodes.length);
      }
    }
  });

  it('parks undated nodes in their own lane, below the dated ones', () => {
    const mixed: LayoutGraph = {
      nodes: [
        node('dated', { observedAt: '2026-01-01T00:00:00.000Z', group: 'a' }),
        node('other', { observedAt: '2026-02-01T00:00:00.000Z', group: 'b' }),
        node('undated', { observedAt: null }),
        node('unparseable', { observedAt: 'not a date' }),
      ],
      edges: [],
    };
    const result = runLayout(mixed, { algorithm: 'timeline', preserveCentroid: false });
    const at = (id: string) => result.positions.find((p) => p.id === id);
    expect(at('undated')?.y).toBeGreaterThan(at('dated')?.y ?? 0);
    expect(at('unparseable')?.y).toBe(at('undated')?.y);
    // Lanes come from the grouping key, so two dated nodes in different groups do not share a row.
    expect(at('other')?.y).not.toBe(at('dated')?.y);
  });

  it('clusters by group key when there is one, and by component when there is not', () => {
    const grouped = runLayout(syntheticGraph(30), { algorithm: 'cluster' });
    const ungrouped = runLayout(
      { nodes: syntheticGraph(30).nodes.map((n) => ({ ...n, group: null })), edges: [] },
      { algorithm: 'cluster' },
    );
    expect(grouped.positions).toHaveLength(30);
    expect(ungrouped.positions).toHaveLength(30);
  });

  it('separates coincident nodes deterministically', () => {
    const pile: LayoutGraph = {
      nodes: Array.from({ length: 12 }, (_, i) => node(`p${String(i)}`, { x: 0, y: 0 })),
      edges: [],
    };
    const a = runLayout(pile, { algorithm: 'force' });
    const b = runLayout(pile, { algorithm: 'force' });
    expect(a.positions).toEqual(b.positions);
    expect(a.stats.overlaps).toBe(0);
  });

  it('can be told not to preserve the centroid', () => {
    const shifted: LayoutGraph = {
      nodes: graph.nodes.map((n) => ({ ...n, x: n.x + 50_000 })),
      edges: graph.edges,
    };
    const anchored = runLayout(shifted, { algorithm: 'tree' });
    const free = runLayout(shifted, { algorithm: 'tree', preserveCentroid: false });
    expect(anchored.stats.bounds.x).toBeGreaterThan(free.stats.bounds.x);
  });

  it('wraps many components into rows in the radial layout', () => {
    const many: LayoutGraph = {
      nodes: Array.from({ length: 60 }, (_, i) => node(`c${String(i)}`, { w: 900, h: 600 })),
      edges: [],
    };
    const result = runLayout(many, { algorithm: 'radial', preserveCentroid: false });
    expect(new Set(result.positions.map((p) => p.y)).size).toBeGreaterThan(1);
  });

  it('keeps a pure cycle component and an isolated node in a tree layout', () => {
    const graphWithCycle: LayoutGraph = {
      nodes: [node('a'), node('b'), node('c'), node('island')],
      edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    };
    const result = runLayout(graphWithCycle, { algorithm: 'tree' });
    expect(result.positions.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'island']);
  });
});
