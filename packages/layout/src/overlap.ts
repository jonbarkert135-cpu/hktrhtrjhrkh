/**
 * Overlap separation. Every algorithm produces an ideal arrangement; this pass makes it legal —
 * no two cards may overlap, and pinned cards never move (they are obstacles, not participants).
 *
 * The pass is a bounded, deterministic relaxation over a uniform grid: O(n · k) with k the number
 * of candidates in the 3×3 cell neighbourhood, which is what keeps a 5,000-node board inside the
 * frame budget instead of the O(n²) all-pairs check.
 */

import { SPACING } from './spacing.ts';

export interface Placement {
  readonly id: string;
  x: number;
  y: number;
  readonly w: number;
  readonly h: number;
  readonly pinned: boolean;
}

const MAX_PASSES = 64;

function overlapAmount(a: Placement, b: Placement, clearance: number): { dx: number; dy: number } {
  const dx = (a.w + b.w) / 2 + clearance - Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
  const dy = (a.h + b.h) / 2 + clearance - Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
  return { dx, dy };
}

/**
 * Separates `items` in place. Returns the number of overlapping pairs still left, which is 0 for
 * any layout that converged — `stats.overlaps` in the result, and asserted by the unit tests.
 */
export function separate(items: Placement[], clearance: number = SPACING.minClearance): number {
  if (items.length < 2) return 0;
  let cell = 0;
  for (const item of items) cell = Math.max(cell, item.w + clearance, item.h + clearance);
  if (cell <= 0) cell = 1;

  let remaining = 0;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i] as Placement;
      const key = `${String(Math.floor((item.x + item.w / 2) / cell))}:${String(
        Math.floor((item.y + item.h / 2) / cell),
      )}`;
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [i]);
      else bucket.push(i);
    }

    remaining = 0;
    for (let i = 0; i < items.length; i += 1) {
      const a = items[i] as Placement;
      const cx = Math.floor((a.x + a.w / 2) / cell);
      const cy = Math.floor((a.y + a.h / 2) / cell);
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          for (const j of buckets.get(`${String(cx + ox)}:${String(cy + oy)}`) ?? []) {
            if (j <= i) continue;
            const b = items[j] as Placement;
            const { dx, dy } = overlapAmount(a, b, clearance);
            if (dx <= 0 || dy <= 0) continue;
            remaining += 1;
            // Push along the cheaper axis; ties break on x so the result is order-independent.
            const alongX = dx <= dy;
            const push = (alongX ? dx : dy) / 2 + 1;
            const aFirst = alongX ? a.x + a.w / 2 <= b.x + b.w / 2 : a.y + a.h / 2 <= b.y + b.h / 2;
            const sign = aFirst ? -1 : 1;
            const aShare = a.pinned ? 0 : b.pinned ? 2 : 1;
            const bShare = b.pinned ? 0 : a.pinned ? 2 : 1;
            if (alongX) {
              a.x += sign * push * aShare;
              b.x -= sign * push * bShare;
            } else {
              a.y += sign * push * aShare;
              b.y -= sign * push * bShare;
            }
          }
        }
      }
    }
    if (remaining === 0) return 0;
  }
  return remaining;
}

/** Counts overlapping pairs without moving anything — the assertion helper for tests and stats. */
export function countOverlaps(
  items: readonly Placement[],
  clearance: number = SPACING.minClearance,
): number {
  let count = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const { dx, dy } = overlapAmount(items[i] as Placement, items[j] as Placement, clearance);
      if (dx > 0 && dy > 0) count += 1;
    }
  }
  return count;
}
