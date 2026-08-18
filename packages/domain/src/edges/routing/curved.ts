/**
 * Curved routing (07_EDGE_SYSTEM.md §7.3). A cubic bezier that leaves and enters the cards along
 * their port normals — the property that makes a dense graph readable, because every line is
 * perpendicular to the card it touches.
 */

import { add, distance, dot, normalize, perpendicular, scale, sub } from './geometry.ts';
import { siblingOffset } from './separation.ts';
import type { PathCommand, Point } from './types.ts';

/** Control-point reach limits (07 §7.3). */
export const MIN_CONTROL_REACH = 24;
export const MAX_CONTROL_REACH = 220;

/**
 * A cubic moves its mid-point by 3/4 of a shift applied to both control points, so to displace the
 * visible mid-curve by `2 · offset` (07 §7.6) the controls move by `8/3 · offset`.
 */
const CONTROL_SHIFT_FOR_MID = 8 / 3;

export interface CurvedInput {
  readonly p0: Point;
  readonly p1: Point;
  /** Outward unit normals of the two ports. */
  readonly n0: Point;
  readonly n1: Point;
  readonly waypoints: readonly Point[];
  readonly curvature: number;
  readonly siblingIndex: number;
  readonly siblingCount: number;
}

/** The reach of the control points, self-adjusting to avoid the classic S-loop overshoot. */
export function controlReach(input: {
  p0: Point;
  p1: Point;
  n0: Point;
  n1: Point;
  curvature: number;
}): number {
  const dist = distance(input.p0, input.p1);
  let k = Math.max(MIN_CONTROL_REACH, Math.min(MAX_CONTROL_REACH, dist * input.curvature));
  // Ports facing each other over a short gap: shrink the reach so the curve does not overshoot.
  const facing = dot(input.n0, input.n1) < -0.5;
  if (facing && dist < 2 * k) k = dist / 2;
  return k;
}

export function routeCurved(input: CurvedInput): PathCommand[] {
  const offset = siblingOffset(input.siblingIndex, input.siblingCount);
  const perp = perpendicular(normalize(sub(input.p1, input.p0)));
  const shift = scale(perp, offset * CONTROL_SHIFT_FOR_MID);

  if (input.waypoints.length === 0) {
    const k = controlReach(input);
    const c0 = add(add(input.p0, scale(input.n0, k)), shift);
    const c1 = add(add(input.p1, scale(input.n1, k)), shift);
    return [
      { t: 'M', x: input.p0.x, y: input.p0.y },
      { t: 'C', x1: c0.x, y1: c0.y, x2: c1.x, y2: c1.y, x: input.p1.x, y: input.p1.y },
    ];
  }

  const through: Point[] = [
    input.p0,
    ...input.waypoints.map((w) => add(w, scale(perp, offset))),
    input.p1,
  ];
  return catmullRomToBezier(through, 0.5, input.n0, scale(input.n1, -1));
}

/**
 * Catmull-Rom through the given points, converted to cubics (07 §7.3). The first and last tangents
 * are forced to the port normals so the endpoint-perpendicular guarantee survives waypoints.
 */
export function catmullRomToBezier(
  points: readonly Point[],
  tension: number,
  startTangent?: Point,
  endTangent?: Point,
): PathCommand[] {
  const n = points.length;
  const first = points[0] as Point;
  const cmds: PathCommand[] = [{ t: 'M', x: first.x, y: first.y }];
  if (n < 2) return cmds;

  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i] as Point;
    const p1 = points[i + 1] as Point;
    const prev = i === 0 ? undefined : (points[i - 1] as Point);
    const next = i + 2 < n ? (points[i + 2] as Point) : undefined;
    const span = distance(p0, p1);

    const t0 =
      prev === undefined
        ? scale(startTangent ?? normalize(sub(p1, p0)), 1)
        : scale(normalize(sub(p1, prev)), 1);
    const t1 =
      next === undefined
        ? scale(endTangent ?? normalize(sub(p1, p0)), 1)
        : scale(normalize(sub(next, p0)), 1);

    const reach = span * tension * (2 / 3);
    const c0 = add(p0, scale(t0, reach));
    // The end tangent points *into* the segment, so it is subtracted at the far control point.
    const c1 = sub(p1, scale(t1, reach));
    cmds.push({ t: 'C', x1: c0.x, y1: c0.y, x2: c1.x, y2: c1.y, x: p1.x, y: p1.y });
  }
  return cmds;
}
