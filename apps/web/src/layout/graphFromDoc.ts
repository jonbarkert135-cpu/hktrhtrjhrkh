/**
 * Document → layout graph. The layout engine knows nothing about Yjs or about node types: it gets
 * ids, boxes, edges and two hints (a date and a grouping key), which is all any of the algorithms
 * needs (`@nexus/layout`).
 */

import { listEdges, listNodes, type BoardNode } from '@nexus/domain';
import type { LayoutGraph, LayoutNode } from '@nexus/layout';
import type * as Y from 'yjs';

/**
 * `observed_at` with the documented fallback (`03_UX.md` §16): provenance's observation instant
 * first, then when the node was created. The timeline lane label says which one it used.
 */
export function observedAtOf(node: BoardNode): string {
  const provenance = node.provenance as { observedAt?: string | null } | undefined;
  return provenance?.observedAt ?? node.createdAt;
}

/** Locked nodes are pinned: "Auto Arrange" must never move something the analyst locked. */
export function layoutNodeOf(node: BoardNode): LayoutNode {
  return {
    id: node.id,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    pinned: node.locked,
    observedAt: observedAtOf(node),
    // Grouping key for `cluster`/`timeline`: the node's group when it has one, else its type.
    group: node.parentId ?? node.type,
  };
}

export function graphFromDoc(doc: Y.Doc): LayoutGraph {
  const nodes = listNodes(doc)
    .filter((node) => node.status === 'active' && !node.hidden)
    .map(layoutNodeOf);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = listEdges(doc)
    .filter(
      (edge) =>
        edge.status === 'active' &&
        !edge.hidden &&
        ids.has(edge.source.nodeId) &&
        ids.has(edge.target.nodeId),
    )
    .map((edge) => ({ id: edge.id, source: edge.source.nodeId, target: edge.target.nodeId }));
  return { nodes, edges };
}
