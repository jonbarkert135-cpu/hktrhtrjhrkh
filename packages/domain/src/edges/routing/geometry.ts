/**
 * Polyline and bezier primitives shared by every routing mode (07_EDGE_SYSTEM.md §4.3, §7.3).
 *
 * Everything here is allocation-light and deterministic: the same inputs produce bit-identical
 * output on every client, which is what makes routed geometry safe to compare in tests and to
 * cache across a collaborative session.
 */

import type { BBox, OrientedPoint, PathCommand, Point } from './types.ts';

/** Adaptive flattening stops when the chord deviates less than this many canvas units (07 §4.3). */
export const FLATTEN_TOLERANCE = 0.35;
/** Segment caps: 64 at full fidelity, 8 in draft mode (07 §4.2 L1, §4.3). */
export const FLATTEN_MAX_SEGMENTS = 64;
export const FLATTEN_DRAFT_SEGMENTS = 8;

export const EPSILON = 1e-9;

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(a: Point, k: number): Point {
  return { x: a.x * k, y: a.y * k };
}

export function length(a: Point): number {
  return Math.hypot(a.x, a.y);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Unit vector; the zero vector maps to `{1, 0}` so callers never divide by zero. */
export function normalize(a: Point): Point {
  const len = length(a);
  return len < EPSILON ? { x: 1, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** Left-hand perpendicular, i.e. `(x, y) → (-y, x)`. */
export function perpendicular(a: Point): Point {
  return { x: -a.y, y: a.x };
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function centerOf(box: { x: number; y: number; w: number; h: number }): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/* ------------------------------------------------------------------ beziers */

export function cubicAt(p0: Point, c0: Point, c1: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c0.x + c * c1.x + d * p1.x,
    y: a * p0.y + b * c0.y + c * c1.y + d * p1.y,
  };
}

export function quadraticAt(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

/**
 * Segment count for a cubic, picked from its control-polygon "flatness" so a nearly straight curve
 * costs 2 segments and a hairpin costs the cap. Cheaper and steadier than recursive subdivision,
 * and the deviation bound is what the spec actually asks for.
 */
export function cubicSegments(
  p0: Point,
  c0: Point,
  c1: Point,
  p1: Point,
  maxSegments: number,
): number {
  const dev = distance(p0, c0) + distance(c0, c1) + distance(c1, p1) - distance(p0, p1);
  if (dev <= FLATTEN_TOLERANCE) return 2;
  const n = Math.ceil(Math.sqrt(dev / FLATTEN_TOLERANCE) * 2);
  return Math.max(2, Math.min(maxSegments, n));
}

/* ---------------------------------------------------------------- polylines */

/** Appends `p` to `out` unless it duplicates the previous point. */
export function pushPoint(out: number[], p: Point): void {
  const n = out.length;
  if (n >= 2) {
    const px = out[n - 2] as number;
    const py = out[n - 1] as number;
    if (Math.abs(px - p.x) < EPSILON && Math.abs(py - p.y) < EPSILON) return;
  }
  out.push(p.x, p.y);
}

/** Flattens a command list into a `[x0, y0, x1, y1, …]` polyline. */
export function flattenCommands(
  cmds: readonly PathCommand[],
  maxSegments = FLATTEN_MAX_SEGMENTS,
): number[] {
  const out: number[] = [];
  let cursor: Point = { x: 0, y: 0 };
  for (const cmd of cmds) {
    if (cmd.t === 'M' || cmd.t === 'L') {
      cursor = { x: cmd.x, y: cmd.y };
      pushPoint(out, cursor);
      continue;
    }
    const end: Point = { x: cmd.x, y: cmd.y };
    if (cmd.t === 'C') {
      const c0: Point = { x: cmd.x1, y: cmd.y1 };
      const c1: Point = { x: cmd.x2, y: cmd.y2 };
      const n = cubicSegments(cursor, c0, c1, end, maxSegments);
      for (let i = 1; i <= n; i += 1) pushPoint(out, cubicAt(cursor, c0, c1, end, i / n));
    } else {
      const c: Point = { x: cmd.x1, y: cmd.y1 };
      const n = cubicSegments(cursor, c, c, end, maxSegments);
      for (let i = 1; i <= n; i += 1) pushPoint(out, quadraticAt(cursor, c, end, i / n));
    }
    cursor = end;
  }
  // A degenerate path (identical endpoints) must still expose two points for hit-testing.
  if (out.length < 4) out.push(cursor.x, cursor.y);
  return out;
}

export function pointCount(flat: ArrayLike<number>): number {
  return Math.floor(flat.length / 2);
}

export function pointAtIndex(flat: ArrayLike<number>, i: number): Point {
  return { x: flat[i * 2] as number, y: flat[i * 2 + 1] as number };
}

export function polylineLength(flat: ArrayLike<number>): number {
  let total = 0;
  for (let i = 1; i < pointCount(flat); i += 1) {
    total += distance(pointAtIndex(flat, i - 1), pointAtIndex(flat, i));
  }
  return total;
}

export function polylineBBox(flat: ArrayLike<number>): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pointCount(flat); i += 1) {
    const p = pointAtIndex(flat, i);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** The point at fraction `t` (0..1) of the arc length, with the tangent angle there. */
export function pointAtFraction(flat: ArrayLike<number>, t: number): OrientedPoint {
  const count = pointCount(flat);
  const first = pointAtIndex(flat, 0);
  if (count < 2) return { x: first.x, y: first.y, angle: 0 };
  const total = polylineLength(flat);
  const wanted = Math.max(0, Math.min(1, t)) * total;
  let walked = 0;
  for (let i = 1; i < count; i += 1) {
    const a = pointAtIndex(flat, i - 1);
    const b = pointAtIndex(flat, i);
    const seg = distance(a, b);
    if (seg < EPSILON) continue;
    if (walked + seg >= wanted || i === count - 1) {
      const local = seg < EPSILON ? 0 : (wanted - walked) / seg;
      const p = lerp(a, b, Math.max(0, Math.min(1, local)));
      return { x: p.x, y: p.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    walked += seg;
  }
  const last = pointAtIndex(flat, count - 1);
  const prev = pointAtIndex(flat, count - 2);
  return { x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x) };
}

/** Squared distance from `p` to the segment `a→b`, plus the clamped parameter along it. */
export function projectOnSegment(p: Point, a: Point, b: Point): { d2: number; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const raw = len2 < EPSILON ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  const t = Math.max(0, Math.min(1, raw));
  const dx = a.x + abx * t - p.x;
  const dy = a.y + aby * t - p.y;
  return { d2: dx * dx + dy * dy, t };
}

/** Shortest distance from `p` to a flattened polyline. */
export function distanceToPolyline(flat: ArrayLike<number>, p: Point): number {
  const count = pointCount(flat);
  if (count === 0) return Infinity;
  if (count === 1) return distance(p, pointAtIndex(flat, 0));
  let best = Infinity;
  for (let i = 1; i < count; i += 1) {
    const { d2 } = projectOnSegment(p, pointAtIndex(flat, i - 1), pointAtIndex(flat, i));
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/* -------------------------------------------------------------------- boxes */

export function boxToBBox(box: { x: number; y: number; w: number; h: number }): BBox {
  return { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h };
}

export function inflate(bbox: BBox, by: number): BBox {
  return {
    minX: bbox.minX - by,
    minY: bbox.minY - by,
    maxX: bbox.maxX + by,
    maxY: bbox.maxY + by,
  };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function bboxContains(b: BBox, p: Point): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

export function bboxOfPoints(points: readonly Point[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
