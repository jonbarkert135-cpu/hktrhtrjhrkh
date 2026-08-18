/**
 * Endpoint clipping (07_EDGE_SYSTEM.md §7.4). A routed path is generated between the two port
 * points, which sit exactly on the card borders; clipping trims whatever re-enters a card and
 * leaves a constant visual gap, then reports the tangent angle so the arrowhead can be rotated.
 *
 * Raven cards are rounded rectangles, so containment is the analytic rounded-rect test and the
 * crossing is found by bisecting the segment that straddles the border — six iterations put the
 * error below 1/64 of a segment, far under one screen pixel at any usable zoom.
 */

import { distance, lerp, pointAtIndex, pointCount } from './geometry.ts';
import type { NodeBox, OrientedPoint, Point } from './types.ts';
import { ENDPOINT_GAP } from './types.ts';

const BISECTIONS = 6;

/** Is `p` inside `box` inflated by `gap`, treating the corners as arcs of the card radius? */
export function insideRoundedBox(p: Point, box: NodeBox, gap = 0): boolean {
  const minX = box.x - gap;
  const minY = box.y - gap;
  const maxX = box.x + box.w + gap;
  const maxY = box.y + box.h + gap;
  if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) return false;

  const r = Math.min(box.radius + gap, (maxX - minX) / 2, (maxY - minY) / 2);
  if (r <= 0) return true;

  // Only the four corner squares can fall outside the rounded silhouette.
  const cx = p.x < minX + r ? minX + r : p.x > maxX - r ? maxX - r : p.x;
  const cy = p.y < minY + r ? minY + r : p.y > maxY - r ? maxY - r : p.y;
  if (cx === p.x || cy === p.y) return true;
  return Math.hypot(p.x - cx, p.y - cy) <= r;
}

/** The crossing point on the border between an inside and an outside sample. */
function bisect(inside: Point, outside: Point, box: NodeBox, gap: number): Point {
  let lo = inside;
  let hi = outside;
  for (let i = 0; i < BISECTIONS; i += 1) {
    const mid = lerp(lo, hi, 0.5);
    if (insideRoundedBox(mid, box, gap)) lo = mid;
    else hi = mid;
  }
  return hi;
}

export interface ClipResult {
  /** The polyline with both ends trimmed; always at least two points. */
  readonly flat: number[];
  readonly start: OrientedPoint;
  readonly end: OrientedPoint;
}

/**
 * Trims both ends of `flat` to the borders of the two boxes.
 *
 * A path whose samples are *all* inside a card (two heavily overlapping nodes, or a node dragged
 * onto another) cannot be clipped meaningfully; in that case the original endpoints are kept, so
 * the edge stays visible and selectable instead of collapsing to nothing.
 */
export function clipToBoxes(
  flat: readonly number[],
  source: NodeBox,
  target: NodeBox,
  gap: number = ENDPOINT_GAP,
): ClipResult {
  const points: Point[] = [];
  for (let i = 0; i < pointCount(flat); i += 1) points.push(pointAtIndex(flat, i));
  if (points.length < 2) {
    const only = points[0] ?? { x: 0, y: 0 };
    const one: OrientedPoint = { x: only.x, y: only.y, angle: 0 };
    return { flat: [only.x, only.y, only.x, only.y], start: one, end: one };
  }

  const firstOutside = points.findIndex((p) => !insideRoundedBox(p, source, gap));

  let head = points;
  let startPoint = points[0] as Point;
  if (firstOutside > 0) {
    startPoint = bisect(
      points[firstOutside - 1] as Point,
      points[firstOutside] as Point,
      source,
      gap,
    );
    head = [startPoint, ...points.slice(firstOutside)];
  }

  let tail = head;
  let endPoint = head[head.length - 1] as Point;
  const tailIndex = findLastIndex(head, (p) => !insideRoundedBox(p, target, gap));
  if (tailIndex >= 0 && tailIndex < head.length - 1) {
    endPoint = bisect(head[tailIndex + 1] as Point, head[tailIndex] as Point, target, gap);
    tail = [...head.slice(0, tailIndex + 1), endPoint];
  }

  if (tail.length < 2) tail = [startPoint, endPoint];

  const out: number[] = [];
  for (const p of tail) out.push(p.x, p.y);

  const a = tail[0] as Point;
  const b = firstDistinct(tail, 1, 1) ?? tail[1] ?? a;
  const z = tail[tail.length - 1] as Point;
  const y = firstDistinct(tail, tail.length - 2, -1) ?? tail[tail.length - 2] ?? z;
  return {
    flat: out,
    start: { x: a.x, y: a.y, angle: Math.atan2(b.y - a.y, b.x - a.x) },
    end: { x: z.x, y: z.y, angle: Math.atan2(z.y - y.y, z.x - y.x) },
  };
}

/** First point from `from` walking by `step` that differs from the anchor end, if any. */
function firstDistinct(points: readonly Point[], from: number, step: number): Point | undefined {
  const anchor = step > 0 ? (points[0] as Point) : (points[points.length - 1] as Point);
  for (let i = from; i >= 0 && i < points.length; i += step) {
    const p = points[i] as Point;
    if (distance(p, anchor) > 1e-6) return p;
  }
  return undefined;
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i] as T)) return i;
  }
  return -1;
}

/**
 * Shortens a polyline by `startTrim` / `endTrim` canvas units, used so a stroke does not poke
 * through an arrowhead tip (07 §7.4). Trims larger than the path length collapse to the midpoint
 * rather than inverting the path.
 */
export function trimPolyline(
  flat: readonly number[],
  startTrim: number,
  endTrim: number,
): number[] {
  const points: Point[] = [];
  for (let i = 0; i < pointCount(flat); i += 1) points.push(pointAtIndex(flat, i));
  if (points.length < 2) return [...flat];

  const trimmedFront = walkTrim(points, startTrim);
  const trimmedBack = walkTrim([...trimmedFront].reverse(), endTrim).reverse();
  const out: number[] = [];
  for (const p of trimmedBack) out.push(p.x, p.y);
  return out;
}

function walkTrim(points: readonly Point[], amount: number): Point[] {
  if (amount <= 0) return [...points];
  let remaining = amount;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const seg = distance(a, b);
    if (seg >= remaining) {
      const cut = lerp(a, b, seg === 0 ? 0 : remaining / seg);
      return [cut, ...points.slice(i)];
    }
    remaining -= seg;
  }
  const last = points[points.length - 1] as Point;
  const mid = lerp(points[0] as Point, last, 0.5);
  return [mid, last];
}
