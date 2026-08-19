/**
 * Straight routing (07_EDGE_SYSTEM.md §7.2): the cheapest mode, and the one every other mode
 * degrades to below 40 screen px. O(w) in the number of waypoints.
 */

import { normalize, perpendicular, sub } from './geometry.ts';
import { siblingOffset } from './separation.ts';
import type { PathCommand, Point } from './types.ts';

export interface StraightInput {
  readonly p0: Point;
  readonly p1: Point;
  readonly waypoints: readonly Point[];
  readonly siblingIndex: number;
  readonly siblingCount: number;
  /** Perpendicular spacing of the parallel group; bundling shrinks it (07 §7.6). */
  readonly separation?: number;
}

/** Commands for a straight (or waypointed) run, with the parallel-edge offset applied. */
export function routeStraight(input: StraightInput): PathCommand[] {
  const offset = siblingOffset(input.siblingIndex, input.siblingCount, input.separation);
  const shift =
    offset === 0
      ? { x: 0, y: 0 }
      : scaleBy(perpendicular(normalize(sub(input.p1, input.p0))), offset);

  const points: Point[] = [
    translate(input.p0, shift),
    ...input.waypoints.map((w) => translate(w, shift)),
    translate(input.p1, shift),
  ];

  const first = points[0] as Point;
  const cmds: PathCommand[] = [{ t: 'M', x: first.x, y: first.y }];
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i] as Point;
    cmds.push({ t: 'L', x: p.x, y: p.y });
  }
  return cmds;
}

function translate(p: Point, by: Point): Point {
  return { x: p.x + by.x, y: p.y + by.y };
}

function scaleBy(p: Point, k: number): Point {
  return { x: p.x * k, y: p.y * k };
}
