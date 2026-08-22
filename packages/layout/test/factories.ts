import type { LayoutEdge, LayoutGraph, LayoutNode } from '../src/index.ts';

export function node(id: string, patch: Partial<LayoutNode> = {}): LayoutNode {
  return { id, x: 0, y: 0, w: 320, h: 180, ...patch };
}

export function edge(source: string, target: string): LayoutEdge {
  return { id: `${source}->${target}`, source, target };
}

/** A deterministic pseudo-random graph: `count` nodes, each linked to a couple of earlier ones. */
export function syntheticGraph(count: number, edgeFactor = 2): LayoutGraph {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  for (let i = 0; i < count; i += 1) {
    nodes.push(
      node(`n${String(i)}`, {
        x: (i % 40) * 400,
        y: Math.floor(i / 40) * 260,
        w: 280 + (i % 3) * 40,
        h: 160 + (i % 2) * 40,
        observedAt: new Date(Date.UTC(2024, 0, 1 + (i % 300))).toISOString(),
        group: `g${String(i % 7)}`,
      }),
    );
  }
  for (let i = 1; i < count; i += 1) {
    for (let k = 0; k < edgeFactor; k += 1) {
      const from = (i * 7 + k * 13) % i;
      edges.push({
        id: `e${String(i)}_${String(k)}`,
        source: `n${String(from)}`,
        target: `n${String(i)}`,
      });
    }
  }
  return { nodes, edges };
}
