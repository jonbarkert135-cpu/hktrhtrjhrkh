/**
 * Manual waypoint editing (07_EDGE_SYSTEM.md §8.3, roadmap P5 part 4 §1).
 *
 * Pure list maths over the stored, absolute waypoints of an edge: where a new one belongs, how a
 * drag rewrites one, which ones ended up inside a card. The gestures live in the engine FSM and
 * the writes in the host binding; nothing here knows about either.
 */

import { projectOnSegment } from './geometry.ts';
import type { NodeBox, Point, Waypoint } from './types.ts';

/** Pointer tolerance for grabbing a waypoint, in screen px (07 §10.1 uses the same scale). */
export const WAYPOINT_HIT_PX = 8;

/** The polyline a waypoint list implies: the two endpoints with the waypoints in between. */
const chain = (waypoints: readonly Waypoint[], p0: Point, p1: Point): Point[] => [
  p0,
  ...waypoints,
  p1,
];

/**
 * Index at which a waypoint created at `at` keeps the run in order: the segment of the current
 * chain the point is nearest to. A double-click on the first half of a straight edge therefore
 * inserts before an existing waypoint, not after it.
 */
export function waypointInsertIndex(
  waypoints: readonly Waypoint[],
  p0: Point,
  p1: Point,
  at: Point,
): number {
  const points = chain(waypoints, p0, p1);
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const { d2 } = projectOnSegment(at, points[i - 1] as Point, points[i] as Point);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i - 1;
    }
  }
  return best;
}

export function insertWaypoint(
  waypoints: readonly Waypoint[],
  p0: Point,
  p1: Point,
  at: Point,
): Waypoint[] {
  const index = waypointInsertIndex(waypoints, p0, p1, at);
  const next = [...waypoints];
  next.splice(index, 0, { x: at.x, y: at.y });
  return next;
}

/** Out-of-range indices are ignored: a stale gesture must not corrupt the list. */
export function moveWaypoint(waypoints: readonly Waypoint[], index: number, at: Point): Waypoint[] {
  if (index < 0 || index >= waypoints.length) return [...waypoints];
  const next = [...waypoints];
  next[index] = { x: at.x, y: at.y };
  return next;
}

export function removeWaypoint(waypoints: readonly Waypoint[], index: number): Waypoint[] {
  if (index < 0 || index >= waypoints.length) return [...waypoints];
  return waypoints.filter((_, i) => i !== index);
}

/** Index of the waypoint under `at` within `tolerance` world units, nearest first. */
export function nearestWaypoint(
  waypoints: readonly Waypoint[],
  at: Point,
  tolerance: number,
): number | null {
  let best: number | null = null;
  let bestD2 = tolerance * tolerance;
  for (let i = 0; i < waypoints.length; i += 1) {
    const w = waypoints[i] as Waypoint;
    const d2 = (w.x - at.x) ** 2 + (w.y - at.y) ** 2;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/**
 * Waypoints that ended up inside a card. Legal — an analyst may want a line to pass behind a card —
 * but the inspector says so, because the routed line is then partly hidden (P5 part 4 §1).
 */
export function waypointsInsideBoxes(
  waypoints: readonly Waypoint[],
  boxes: readonly NodeBox[],
): number[] {
  const inside: number[] = [];
  for (let i = 0; i < waypoints.length; i += 1) {
    const w = waypoints[i] as Waypoint;
    if (boxes.some((b) => w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h)) {
      inside.push(i);
    }
  }
  return inside;
}
