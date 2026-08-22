/**
 * The one entry point: graph in, proposed positions out. Pure — it reads nothing, writes nothing
 * and never touches a document. Applying the result is the host's job, and only after an accept
 * (`00_MASTER.md` §3.3, N4).
 *
 * Post-processing is shared by every algorithm and is where the guarantees live:
 * pinned nodes restored → centroid preserved → overlaps separated → positions snapped to the grid.
 */

import { LAYOUT_CATALOGUE } from './catalogue.ts';
import { buildAdjacency } from './graph.ts';
import { countOverlaps, separate, type Placement } from './overlap.ts';
import { createRng } from './rng.ts';
import { snap } from './spacing.ts';
import type { ResolvedOptions } from './algorithms/shared.ts';
import { checkpoint } from './algorithms/shared.ts';
import type {
  LayoutAlgorithmId,
  LayoutDiff,
  LayoutGraph,
  LayoutOptions,
  LayoutPosition,
  LayoutResult,
  LayoutRunContext,
  LayoutStats,
} from './types.ts';

export interface RunLayoutRequest extends LayoutOptions {
  readonly algorithm: LayoutAlgorithmId;
}

function resolveOptions(request: RunLayoutRequest): ResolvedOptions {
  const defaults = LAYOUT_CATALOGUE[request.algorithm].defaults;
  return {
    seed: request.seed ?? defaults.seed,
    spacingX: request.spacingX ?? defaults.spacingX,
    spacingY: request.spacingY ?? defaults.spacingY,
    direction: request.direction ?? defaults.direction,
    iterations: request.iterations ?? defaults.iterations,
    preserveCentroid: request.preserveCentroid ?? true,
  };
}

function centroid(items: readonly { x: number; y: number; w: number; h: number }[]): {
  x: number;
  y: number;
} {
  if (items.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const item of items) {
    x += item.x + item.w / 2;
    y += item.y + item.h / 2;
  }
  return { x: x / items.length, y: y / items.length };
}

function boundsOf(items: readonly Placement[]): { x: number; y: number; w: number; h: number } {
  if (items.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.w);
    maxY = Math.max(maxY, item.y + item.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function runLayout(
  graph: LayoutGraph,
  request: RunLayoutRequest,
  ctx: LayoutRunContext = {},
): LayoutResult {
  const options = resolveOptions(request);
  const descriptor = LAYOUT_CATALOGUE[request.algorithm];
  const view = buildAdjacency(graph);
  checkpoint(ctx, 0);

  const placements =
    graph.nodes.length === 0
      ? []
      : descriptor.run({ graph, view, options, rng: createRng(options.seed), ctx });
  checkpoint(ctx, 0.9);

  const byId = new Map(placements.map((item) => [item.id, item] as const));
  // Any node an algorithm failed to place keeps its current position rather than jumping to 0,0.
  for (const node of graph.nodes)
    if (!byId.has(node.id)) {
      const fallback: Placement = {
        id: node.id,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        pinned: node.pinned === true,
      };
      placements.push(fallback);
      byId.set(node.id, fallback);
    }

  // Keep the board where the analyst left it: when some nodes are pinned they are the anchors and
  // the arrangement is aligned on them before they are restored; when nothing is pinned the whole
  // result is re-centred *after* separation (below), which is what makes a re-run idempotent.
  const pinnedNodes = graph.nodes.filter((node) => node.pinned === true);
  if (options.preserveCentroid && pinnedNodes.length > 0) {
    const before = centroid(pinnedNodes);
    const after = centroid(
      pinnedNodes.map(
        (node) => byId.get(node.id) ?? { x: node.x, y: node.y, w: node.w, h: node.h },
      ),
    );
    for (const item of placements) {
      item.x += before.x - after.x;
      item.y += before.y - after.y;
    }
  }

  // Pinned/locked nodes are not laid out: they go back exactly where they were and act as
  // obstacles for the separation pass (03_UX.md §16 "drag to pin").
  for (const node of pinnedNodes) {
    const item = byId.get(node.id);
    if (item === undefined) continue;
    item.x = node.x;
    item.y = node.y;
  }

  const overlaps = separate(placements);
  for (const item of placements) {
    if (item.pinned) continue;
    item.x = snap(item.x);
    item.y = snap(item.y);
  }

  // Final re-centring, on the grid so it cannot drift: translating the finished arrangement by a
  // whole number of grid cells preserves both the separation and the snapping, and because the
  // algorithms never read the current positions, running the layout again on its own output
  // reproduces the same translation — i.e. an already-arranged board is left alone.
  if (options.preserveCentroid && pinnedNodes.length === 0 && placements.length > 0) {
    const target = centroid(graph.nodes);
    const actual = centroid(placements);
    const dx = snap(target.x - actual.x);
    const dy = snap(target.y - actual.y);
    if (dx !== 0 || dy !== 0)
      for (const item of placements) {
        item.x += dx;
        item.y += dy;
      }
  }
  // Snapping can re-introduce a sub-grid touch; report what is actually true.
  const remaining =
    overlaps === 0 && placements.length <= 512 ? countOverlaps(placements) : overlaps;
  checkpoint(ctx, 1);

  const positions: LayoutPosition[] = placements.map((item) => ({
    id: item.id,
    x: item.x,
    y: item.y,
  }));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  let moved = 0;
  let unchanged = 0;
  let pinned = 0;
  for (const position of positions) {
    const node = nodeById.get(position.id);
    if (node === undefined) continue;
    if (node.pinned === true) pinned += 1;
    else if (node.x === position.x && node.y === position.y) unchanged += 1;
    else moved += 1;
  }
  const stats: LayoutStats = {
    moved,
    unchanged,
    pinned,
    bounds: boundsOf(placements),
    overlaps: remaining,
  };
  return { algorithm: request.algorithm, seed: options.seed, positions, stats };
}

/**
 * The proposal: only the nodes that would actually move, with where they come from — which is what
 * makes the preview drawable, the accept one undo step and the whole thing explainable.
 */
export function toLayoutDiff(graph: LayoutGraph, result: LayoutResult): LayoutDiff {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const moves = result.positions.flatMap((position) => {
    const node = nodeById.get(position.id);
    if (node === undefined || node.pinned === true) return [];
    if (node.x === position.x && node.y === position.y) return [];
    return [
      {
        id: node.id,
        fromX: node.x,
        fromY: node.y,
        x: position.x,
        y: position.y,
        w: node.w,
        h: node.h,
      },
    ];
  });
  return { algorithm: result.algorithm, seed: result.seed, moves, stats: result.stats };
}

/** One call for the common case: run and diff. */
export function proposeLayout(
  graph: LayoutGraph,
  request: RunLayoutRequest,
  ctx: LayoutRunContext = {},
): LayoutDiff {
  return toLayoutDiff(graph, runLayout(graph, request, ctx));
}

/** Human-readable "why does the board look like this now", shown in the accept toast. */
export function explainLayout(diff: LayoutDiff): string {
  const descriptor = LAYOUT_CATALOGUE[diff.algorithm];
  const pinned =
    diff.stats.pinned === 0 ? '' : ` ${String(diff.stats.pinned)} pinned or locked stayed put.`;
  return (
    `${descriptor.label}: ${descriptor.description} ` +
    `${String(diff.moves.length)} of ${String(diff.moves.length + diff.stats.unchanged + diff.stats.pinned)} nodes move.` +
    pinned
  );
}
