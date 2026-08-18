/**
 * Multi-edge separation (07_EDGE_SYSTEM.md §7.6). Edges sharing a node pair are fanned out so no
 * two of them are drawn on top of each other, and very large fans are bundled into one path.
 */

import { BUNDLE_THRESHOLD, SEPARATION } from './types.ts';

/**
 * Signed perpendicular offset for edge `index` of a parallel group of `count`.
 *
 * The `k` sequence is symmetric around zero (`-1, 0, 1` for three edges, `-1.5, -0.5, 0.5, 1.5`
 * for four), so a group is centred on the line it would occupy if it were alone.
 */
export function siblingOffset(index: number, count: number, sep: number = SEPARATION): number {
  if (count <= 1) return 0;
  const clamped = Math.max(0, Math.min(count - 1, index));
  return (clamped - (count - 1) / 2) * sep;
}

/** Above {@link BUNDLE_THRESHOLD} members the group is drawn as a single thicker path. */
export function isBundled(count: number): boolean {
  return count > BUNDLE_THRESHOLD;
}

/** Stroke width of a bundled group: `1.5 + log2(n)` px (07 §7.6). */
export function bundleWidth(count: number): number {
  return 1.5 + Math.log2(Math.max(1, count));
}

/** Tighter spacing used while an expanded bundle is drawn member by member (07 §7.6). */
export const EXPANDED_BUNDLE_SEPARATION = 12;
