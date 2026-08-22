/**
 * Graph utilities shared by the algorithms. Everything here is deterministic: iteration order is
 * always the input order of `graph.nodes`, never a `Set`/`Map` insertion accident.
 */

import type { LayoutEdge, LayoutGraph, LayoutNode } from './types.ts';

export interface AdjacencyView {
  readonly ids: readonly string[];
  readonly nodeById: ReadonlyMap<string, LayoutNode>;
  /** Outgoing neighbours, in edge order, deduplicated, self-loops removed. */
  readonly out: ReadonlyMap<string, readonly string[]>;
  readonly in: ReadonlyMap<string, readonly string[]>;
  /** Undirected neighbours, used for components and force layout. */
  readonly neighbours: ReadonlyMap<string, readonly string[]>;
  readonly edges: readonly LayoutEdge[];
}

export function buildAdjacency(graph: LayoutGraph): AdjacencyView {
  const nodeById = new Map<string, LayoutNode>();
  for (const node of graph.nodes) nodeById.set(node.id, node);
  const ids = graph.nodes.map((node) => node.id);

  const out = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const neighbours = new Map<string, string[]>();
  for (const id of ids) {
    out.set(id, []);
    incoming.set(id, []);
    neighbours.set(id, []);
  }

  const seen = new Set<string>();
  const edges: LayoutEdge[] = [];
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const key = `${edge.source}\u0000${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(edge);
    out.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
    if (!neighbours.get(edge.source)?.includes(edge.target))
      neighbours.get(edge.source)?.push(edge.target);
    if (!neighbours.get(edge.target)?.includes(edge.source))
      neighbours.get(edge.target)?.push(edge.source);
  }

  return { ids, nodeById, out, in: incoming, neighbours, edges };
}

/** Connected components of the undirected graph, each in input order, components in input order. */
export function components(view: AdjacencyView): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const start of view.ids) {
    if (seen.has(start)) continue;
    const queue = [start];
    seen.add(start);
    const group: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      group.push(id);
      for (const next of view.neighbours.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    result.push(group);
  }
  return result;
}

/**
 * Edges that close a cycle, found by a DFS in input order. Layered and tree layouts run on the
 * graph with these removed, which is the standard Sugiyama step 1 (cycle removal).
 */
export function feedbackEdges(view: AdjacencyView): ReadonlySet<string> {
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  for (const id of view.ids) state.set(id, 0);

  for (const root of view.ids) {
    if (state.get(root) !== 0) continue;
    // Explicit stack: an OSINT board can be a 5,000-node chain and recursion would blow up.
    const stack: Array<{ id: string; cursor: number }> = [{ id: root, cursor: 0 }];
    state.set(root, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { id: string; cursor: number };
      const targets = view.out.get(frame.id) ?? [];
      if (frame.cursor >= targets.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const next = targets[frame.cursor] as string;
      frame.cursor += 1;
      const mark = state.get(next) ?? 0;
      if (mark === 1) back.add(`${frame.id}\u0000${next}`);
      else if (mark === 0) {
        state.set(next, 1);
        stack.push({ id: next, cursor: 0 });
      }
    }
  }
  return back;
}

/** The acyclic view: `out`/`in` with the feedback edges dropped. */
export function acyclic(view: AdjacencyView): {
  out: ReadonlyMap<string, readonly string[]>;
  in: ReadonlyMap<string, readonly string[]>;
} {
  const back = feedbackEdges(view);
  const out = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const id of view.ids) {
    out.set(id, []);
    incoming.set(id, []);
  }
  for (const id of view.ids) {
    for (const target of view.out.get(id) ?? []) {
      if (back.has(`${id}\u0000${target}`)) continue;
      out.get(id)?.push(target);
      incoming.get(target)?.push(id);
    }
  }
  return { out, in: incoming };
}

/**
 * Longest-path layering over an acyclic view: rank(n) = 0 for a source, else 1 + max(rank(parents)).
 * Computed iteratively in topological order (Kahn), so it is O(V+E) and stack-safe.
 */
export function rankNodes(
  ids: readonly string[],
  out: ReadonlyMap<string, readonly string[]>,
  incoming: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const id of ids) remaining.set(id, (incoming.get(id) ?? []).length);
  const rank = new Map<string, number>();
  const queue: string[] = [];
  for (const id of ids)
    if ((remaining.get(id) ?? 0) === 0) {
      rank.set(id, 0);
      queue.push(id);
    }
  let cursor = 0;
  while (cursor < queue.length) {
    const id = queue[cursor] as string;
    cursor += 1;
    const here = rank.get(id) ?? 0;
    for (const target of out.get(id) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, here + 1));
      const left = (remaining.get(target) ?? 1) - 1;
      remaining.set(target, left);
      if (left === 0) queue.push(target);
    }
  }
  // Any node the queue never reached sits in a cycle the feedback pass missed: rank it 0 rather
  // than dropping it, because losing a node from a layout is a data-loss bug, not a layout bug.
  for (const id of ids) if (!rank.has(id)) rank.set(id, 0);
  return rank;
}

/**
 * Spanning forest for the tree layout: roots are the nodes with no incoming acyclic edge (or, for
 * a component that has none, its first node in input order).
 */
export function spanningForest(
  view: AdjacencyView,
  out: ReadonlyMap<string, readonly string[]>,
  incoming: ReadonlyMap<string, readonly string[]>,
): { roots: string[]; children: Map<string, string[]>; parent: Map<string, string | null> } {
  const children = new Map<string, string[]>();
  const parent = new Map<string, string | null>();
  for (const id of view.ids) children.set(id, []);

  const roots: string[] = [];
  const visited = new Set<string>();
  const visit = (root: string): void => {
    parent.set(root, null);
    roots.push(root);
    visited.add(root);
    const queue = [root];
    let cursor = 0;
    while (cursor < queue.length) {
      const id = queue[cursor] as string;
      cursor += 1;
      for (const child of out.get(id) ?? []) {
        if (visited.has(child)) continue;
        visited.add(child);
        parent.set(child, id);
        children.get(id)?.push(child);
        queue.push(child);
      }
    }
  };

  for (const id of view.ids)
    if (!visited.has(id) && (incoming.get(id) ?? []).length === 0) visit(id);
  // Components that are pure cycles have no source; anchor them on their first member.
  for (const group of components(view)) {
    const anchor = group.find((id) => !visited.has(id));
    if (anchor !== undefined) visit(anchor);
  }
  for (const id of view.ids) if (!visited.has(id)) visit(id);
  return { roots, children, parent };
}
