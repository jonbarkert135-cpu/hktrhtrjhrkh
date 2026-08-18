/**
 * Edge hit-testing (07_EDGE_SYSTEM.md §10.1). Everything works on the flattened polyline, so a
 * bezier and a 12-corner orthogonal path are picked by exactly the same code.
 *
 * Tolerances are expressed in *screen* pixels and converted with the zoom, because a hit area that
 * shrinks with the zoom is the classic reason users cannot select an edge on a zoomed-out board.
 */

import { distanceToPolyline, pointAtIndex, pointCount, projectOnSegment } from './geometry.ts';
import type { BBox, EdgeGeometry, Point } from './types.ts';

/** Screen-px half-width of the pick corridor: base, and the widened one at L3 / on hover. */
export const HIT_TOLERANCE = 6;
export const HIT_TOLERANCE_WIDE = 10;

export function hitTolerance(zoom: number, wide = false): number {
  const screen = wide ? HIT_TOLERANCE_WIDE : HIT_TOLERANCE;
  return screen / Math.max(zoom, 1e-3);
}

export function bboxHit(bbox: BBox, p: Point, tolerance: number): boolean {
  return (
    p.x >= bbox.minX - tolerance &&
    p.x <= bbox.maxX + tolerance &&
    p.y >= bbox.minY - tolerance &&
    p.y <= bbox.maxY + tolerance
  );
}

/** Distance from a world point to the edge, or `Infinity` when the bbox rejects it outright. */
export function distanceToEdge(geometry: EdgeGeometry, p: Point, tolerance: number): number {
  if (!bboxHit(geometry.bbox, p, tolerance)) return Infinity;
  return distanceToPolyline(geometry.flat, p);
}

export function isEdgeHit(geometry: EdgeGeometry, p: Point, tolerance: number): boolean {
  return distanceToEdge(geometry, p, tolerance) <= tolerance;
}

export interface NearestOnEdge {
  readonly point: Point;
  /** Fraction of the arc length, 0..1 — where a waypoint or a label would be inserted. */
  readonly t: number;
  readonly distance: number;
}

/** The closest point on the edge, with its arc-length parameter. */
export function nearestPointOnEdge(geometry: EdgeGeometry, p: Point): NearestOnEdge {
  const flat = geometry.flat;
  const count = pointCount(flat);
  const first = pointAtIndex(flat, 0);
  if (count < 2) return { point: first, t: 0, distance: Math.hypot(p.x - first.x, p.y - first.y) };

  let bestD2 = Infinity;
  let bestIndex = 1;
  let bestT = 0;
  const lengths: number[] = [0];
  let total = 0;
  for (let i = 1; i < count; i += 1) {
    const a = pointAtIndex(flat, i - 1);
    const b = pointAtIndex(flat, i);
    total += Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(total);
    const { d2, t } = projectOnSegment(p, a, b);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestIndex = i;
      bestT = t;
    }
  }

  const a = pointAtIndex(flat, bestIndex - 1);
  const b = pointAtIndex(flat, bestIndex);
  const point: Point = { x: a.x + (b.x - a.x) * bestT, y: a.y + (b.y - a.y) * bestT };
  const before = lengths[bestIndex - 1] as number;
  const segment = (lengths[bestIndex] as number) - before;
  const t = total === 0 ? 0 : (before + segment * bestT) / total;
  return { point, t, distance: Math.sqrt(bestD2) };
}

export interface EdgeHitCandidate {
  readonly id: string;
  readonly geometry: EdgeGeometry;
  /** Higher wins a tie — selection and hover outrank painting order (07 §10.2). */
  readonly priority?: number;
}

/** The topmost edge under the pointer, or `null`. */
export function pickEdge(
  candidates: readonly EdgeHitCandidate[],
  p: Point,
  tolerance: number,
): EdgeHitCandidate | null {
  let best: EdgeHitCandidate | null = null;
  let bestDistance = Infinity;
  let bestPriority = -Infinity;
  for (const candidate of candidates) {
    const d = distanceToEdge(candidate.geometry, p, tolerance);
    if (d > tolerance) continue;
    const priority = candidate.priority ?? 0;
    if (priority > bestPriority || (priority === bestPriority && d < bestDistance)) {
      best = candidate;
      bestDistance = d;
      bestPriority = priority;
    }
  }
  return best;
}
