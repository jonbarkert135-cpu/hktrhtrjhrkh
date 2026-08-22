import { describe, expect, it } from 'vitest';

import {
  LAYOUT_ALGORITHMS,
  LAYOUT_CATALOGUE,
  LayoutCancelledError,
  countOverlaps,
  explainLayout,
  proposeLayout,
  runLayout,
  type LayoutAlgorithmId,
  type LayoutGraph,
} from '../src/index.ts';
import { edge, node, syntheticGraph } from './factories.ts';

const GRAPH = syntheticGraph(120);

const asPlacements = (graph: LayoutGraph, result: ReturnType<typeof runLayout>) => {
  const sizes = new Map(graph.nodes.map((n) => [n.id, n] as const));
  return result.positions.map((p) => {
    const source = sizes.get(p.id);
    return { id: p.id, x: p.x, y: p.y, w: source?.w ?? 0, h: source?.h ?? 0, pinned: false };
  });
};

describe.each(LAYOUT_ALGORITHMS)('%s layout', (algorithm: LayoutAlgorithmId) => {
  it('is deterministic across runs', () => {
    const a = runLayout(GRAPH, { algorithm });
    const b = runLayout(GRAPH, { algorithm });
    expect(a.positions).toEqual(b.positions);
  });

  it('places every node exactly once', () => {
    const result = runLayout(GRAPH, { algorithm });
    expect(result.positions).toHaveLength(GRAPH.nodes.length);
    expect(new Set(result.positions.map((p) => p.id)).size).toBe(GRAPH.nodes.length);
    for (const position of result.positions) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
  });

  it('leaves no overlapping cards', () => {
    const result = runLayout(GRAPH, { algorithm });
    expect(countOverlaps(asPlacements(GRAPH, result), 0)).toBe(0);
  });

  it('is stable when re-run on its own output', () => {
    const first = runLayout(GRAPH, { algorithm });
    const placed = new Map(first.positions.map((p) => [p.id, p] as const));
    const settled: LayoutGraph = {
      nodes: GRAPH.nodes.map((n) => ({
        ...n,
        x: placed.get(n.id)?.x ?? n.x,
        y: placed.get(n.id)?.y ?? n.y,
      })),
      edges: GRAPH.edges,
    };
    const second = runLayout(settled, { algorithm });
    // A settled board must not be thrown around again: the second pass moves nothing.
    expect(second.stats.moved).toBe(0);
  });

  it('never moves a pinned node', () => {
    const pinnedGraph: LayoutGraph = {
      nodes: GRAPH.nodes.map((n, index) => (index % 10 === 0 ? { ...n, pinned: true } : n)),
      edges: GRAPH.edges,
    };
    const result = runLayout(pinnedGraph, { algorithm });
    const byId = new Map(result.positions.map((p) => [p.id, p] as const));
    for (const n of pinnedGraph.nodes) {
      if (n.pinned !== true) continue;
      expect(byId.get(n.id)).toEqual({ id: n.id, x: n.x, y: n.y });
    }
    expect(result.stats.pinned).toBe(pinnedGraph.nodes.filter((n) => n.pinned === true).length);
  });

  it('reports progress and honours cancellation', () => {
    const seen: number[] = [];
    runLayout(GRAPH, { algorithm }, { onProgress: (value) => seen.push(value) });
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBe(1);

    let calls = 0;
    expect(() =>
      runLayout(
        GRAPH,
        { algorithm },
        {
          isCancelled: () => {
            calls += 1;
            return calls > 1;
          },
        },
      ),
    ).toThrow(LayoutCancelledError);
  });

  it('has a catalogue entry with usable defaults', () => {
    const descriptor = LAYOUT_CATALOGUE[algorithm];
    expect(descriptor.id).toBe(algorithm);
    expect(descriptor.label.length).toBeGreaterThan(0);
    expect(descriptor.options.length).toBeGreaterThan(0);
  });
});

describe('runLayout', () => {
  it('handles an empty board', () => {
    const result = runLayout({ nodes: [], edges: [] }, { algorithm: 'force' });
    expect(result.positions).toEqual([]);
    expect(result.stats).toMatchObject({ moved: 0, overlaps: 0 });
  });

  it('handles a single node without moving it', () => {
    const graph: LayoutGraph = { nodes: [node('a', { x: 40, y: 80 })], edges: [] };
    const result = runLayout(graph, { algorithm: 'hierarchical' });
    expect(result.positions).toEqual([{ id: 'a', x: 40, y: 80 }]);
  });

  it('ignores self-loops, duplicates and dangling edges', () => {
    const graph: LayoutGraph = {
      nodes: [node('a'), node('b', { x: 900 })],
      edges: [edge('a', 'a'), edge('a', 'b'), edge('a', 'b'), edge('a', 'ghost')],
    };
    expect(() => runLayout(graph, { algorithm: 'hierarchical' })).not.toThrow();
  });

  it('lays out a cyclic graph without losing a node', () => {
    const graph: LayoutGraph = {
      nodes: [node('a'), node('b', { x: 500 }), node('c', { x: 1000 })],
      edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    };
    const result = runLayout(graph, { algorithm: 'hierarchical' });
    expect(result.positions.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps the arrangement centred where the nodes already are', () => {
    const graph = syntheticGraph(30);
    const shifted: LayoutGraph = {
      nodes: graph.nodes.map((n) => ({ ...n, x: n.x + 10_000, y: n.y + 10_000 })),
      edges: graph.edges,
    };
    const result = runLayout(shifted, { algorithm: 'tree' });
    const centreX = result.positions.reduce((sum, p) => sum + p.x, 0) / result.positions.length;
    expect(centreX).toBeGreaterThan(5_000);
  });

  it('respects a spacing override', () => {
    const tight = runLayout(GRAPH, { algorithm: 'hierarchical', spacingY: 24 });
    const loose = runLayout(GRAPH, { algorithm: 'hierarchical', spacingY: 400 });
    expect(loose.stats.bounds.h).toBeGreaterThan(tight.stats.bounds.h);
  });

  it('changes shape with the seed for the force layout only', () => {
    const a = runLayout(GRAPH, { algorithm: 'force', seed: 1 });
    const b = runLayout(GRAPH, { algorithm: 'force', seed: 99 });
    expect(a.positions).not.toEqual(b.positions);
  });
});

describe('proposeLayout', () => {
  it('produces a diff of only the nodes that move, with their origin', () => {
    const diff = proposeLayout(GRAPH, { algorithm: 'cluster' });
    expect(diff.moves.length).toBeGreaterThan(0);
    for (const move of diff.moves) {
      expect(move.fromX === move.x && move.fromY === move.y).toBe(false);
    }
    expect(diff.moves.length).toBe(diff.stats.moved);
  });

  it('explains itself in one sentence', () => {
    const diff = proposeLayout(GRAPH, { algorithm: 'radial' });
    expect(explainLayout(diff)).toContain('Radial');
    expect(explainLayout(diff)).toContain('nodes move');
  });
});
