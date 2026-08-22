/**
 * Scoping: whole board, a selection, or the subgraph reachable from a seed set. Scoping happens
 * before the algorithm runs, so "arrange my selection" is the same code path as "arrange the
 * board" — with a smaller graph.
 */

import { buildAdjacency } from './graph.ts';
import type { LayoutGraph } from './types.ts';

export type LayoutScope =
  | { readonly kind: 'board' }
  | { readonly kind: 'selection'; readonly ids: readonly string[] }
  | { readonly kind: 'subgraph'; readonly ids: readonly string[]; readonly depth: number };

/**
 * Nodes outside the scope are dropped from the graph, but they are not forgotten: they are handed
 * back as `obstacles` so the caller can keep them pinned and let the separation pass avoid them.
 */
export function applyScope(
  graph: LayoutGraph,
  scope: LayoutScope,
): { graph: LayoutGraph; excluded: readonly string[] } {
  if (scope.kind === 'board') return { graph, excluded: [] };

  const wanted = new Set<string>(scope.ids);
  if (scope.kind === 'subgraph') {
    const view = buildAdjacency(graph);
    let frontier = [...scope.ids];
    for (let step = 0; step < Math.max(0, scope.depth); step += 1) {
      const next: string[] = [];
      for (const id of frontier)
        for (const neighbour of view.neighbours.get(id) ?? []) {
          if (wanted.has(neighbour)) continue;
          wanted.add(neighbour);
          next.push(neighbour);
        }
      frontier = next;
      if (frontier.length === 0) break;
    }
  }

  const nodes = graph.nodes.filter((node) => wanted.has(node.id));
  const excluded = graph.nodes.filter((node) => !wanted.has(node.id)).map((node) => node.id);
  const edges = graph.edges.filter((edge) => wanted.has(edge.source) && wanted.has(edge.target));
  return { graph: { nodes, edges }, excluded };
}
