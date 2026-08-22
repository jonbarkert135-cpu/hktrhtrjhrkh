/** The contract every algorithm implements, plus the rank-placement machinery two of them share. */

import type { AdjacencyView } from '../graph.ts';
import type { Placement } from '../overlap.ts';
import type { Rng } from '../rng.ts';
import { SPACING } from '../spacing.ts';
import {
  LayoutCancelledError,
  type LayoutDirection,
  type LayoutGraph,
  type LayoutNode,
  type LayoutRunContext,
} from '../types.ts';

export interface ResolvedOptions {
  readonly seed: number;
  readonly spacingX: number;
  readonly spacingY: number;
  readonly direction: LayoutDirection;
  readonly iterations: number;
  readonly preserveCentroid: boolean;
}

export interface AlgorithmInput {
  readonly graph: LayoutGraph;
  readonly view: AdjacencyView;
  readonly options: ResolvedOptions;
  readonly rng: Rng;
  readonly ctx: LayoutRunContext;
}

export type LayoutAlgorithm = (input: AlgorithmInput) => Placement[];

/** Throws `LayoutCancelledError` if the host asked to stop, and reports progress. */
export function checkpoint(ctx: LayoutRunContext, fraction: number): void {
  if (ctx.isCancelled?.() === true) throw new LayoutCancelledError();
  ctx.onProgress?.(Math.min(1, Math.max(0, fraction)));
}

export function placementOf(node: LayoutNode, x: number, y: number): Placement {
  return { id: node.id, x, y, w: node.w, h: node.h, pinned: node.pinned === true };
}

export function isVertical(direction: LayoutDirection): boolean {
  return direction === 'down' || direction === 'up';
}

/**
 * Places ranked nodes: nodes of one rank sit side by side along the primary axis, ranks advance
 * along the cross axis. Shared by `hierarchical` and `flow`, which differ only in how they rank.
 */
export function placeRanks(
  order: readonly (readonly string[])[],
  view: AdjacencyView,
  options: ResolvedOptions,
  originCross = 0,
): Placement[] {
  const vertical = isVertical(options.direction);
  const reversed = options.direction === 'up' || options.direction === 'left';
  const placements: Placement[] = [];
  let cross = originCross;
  for (const rank of order) {
    let crossSize = 0;
    let primary = 0;
    for (const id of rank) {
      const node = view.nodeById.get(id);
      if (node === undefined) continue;
      const primarySize = vertical ? node.w : node.h;
      const across = vertical ? node.h : node.w;
      crossSize = Math.max(crossSize, across);
      const crossPos = reversed ? -cross - across : cross;
      placements.push(
        vertical ? placementOf(node, primary, crossPos) : placementOf(node, crossPos, primary),
      );
      primary += primarySize + options.spacingX;
    }
    cross += crossSize + options.spacingY;
  }
  // Centre every rank on the widest one: a pyramid reads as a pyramid, not as a left-aligned list.
  centreRanks(placements, order, vertical, options.spacingX, view);
  return placements;
}

function centreRanks(
  placements: readonly Placement[],
  order: readonly (readonly string[])[],
  vertical: boolean,
  gap: number,
  view: AdjacencyView,
): void {
  const byId = new Map(placements.map((p) => [p.id, p] as const));
  const extentOf = (rank: readonly string[]): number => {
    let total = 0;
    for (const id of rank) {
      const node = view.nodeById.get(id);
      if (node === undefined) continue;
      total += (vertical ? node.w : node.h) + gap;
    }
    return Math.max(0, total - gap);
  };
  let widest = 0;
  for (const rank of order) widest = Math.max(widest, extentOf(rank));
  for (const rank of order) {
    const shift = (widest - extentOf(rank)) / 2;
    if (shift === 0) continue;
    for (const id of rank) {
      const placement = byId.get(id);
      if (placement === undefined) continue;
      if (vertical) placement.x += shift;
      else placement.y += shift;
    }
  }
}

/**
 * Barycentre ordering (Sugiyama step 3): four alternating sweeps, which is where the crossing
 * count stops improving on real boards and where the cost stops being free.
 */
export function orderByBarycentre(
  ranks: readonly (readonly string[])[],
  view: AdjacencyView,
  ctx: LayoutRunContext,
  baseProgress: number,
): string[][] {
  const order = ranks.map((rank) => [...rank]);
  const positionOf = new Map<string, number>();
  const reindex = (): void => {
    for (const rank of order) rank.forEach((id, index) => positionOf.set(id, index));
  };
  reindex();

  const SWEEPS = 4;
  for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
    checkpoint(ctx, baseProgress + (sweep / SWEEPS) * 0.4);
    const downward = sweep % 2 === 0;
    const indices = downward
      ? order.map((_, index) => index)
      : order.map((_, index) => order.length - 1 - index);
    for (const index of indices) {
      const rank = order[index] as string[];
      const weights = new Map<string, number>();
      for (const id of rank) {
        const refs = downward ? (view.in.get(id) ?? []) : (view.out.get(id) ?? []);
        const known = refs
          .map((ref) => positionOf.get(ref))
          .filter((value): value is number => value !== undefined);
        weights.set(
          id,
          known.length === 0
            ? (positionOf.get(id) ?? 0)
            : known.reduce((sum, value) => sum + value, 0) / known.length,
        );
      }
      // Stable sort on (barycentre, current index): equal weights keep their relative order, which
      // is what makes a re-run of the same layout idempotent.
      rank.sort(
        (a, b) =>
          (weights.get(a) ?? 0) - (weights.get(b) ?? 0) ||
          (positionOf.get(a) ?? 0) - (positionOf.get(b) ?? 0),
      );
      rank.forEach((id, position) => positionOf.set(id, position));
    }
  }
  return order;
}

export const GAPS = SPACING;
