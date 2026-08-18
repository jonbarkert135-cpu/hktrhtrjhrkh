/**
 * The smart chooser (07_EDGE_SYSTEM.md §7.8): picks the mode an experienced analyst would pick,
 * from the distance, the alignment and how crowded the corridor is.
 *
 * The decision is *not* stored in the document — it is part of the cached geometry, so the same
 * edge can render differently as the board changes. That is the whole point of "smart".
 */

import { boxToBBox, centerOf } from './geometry.ts';
import type { EdgeCategory } from '../types.ts';
import { STRAIGHT_DEGRADE_LENGTH } from '../defaults.ts';
import type { BBox, NodeBox, ObstacleSource, Point } from './types.ts';

/** Below this centre distance a curve is invisible, so the mode degrades to straight (07 §7.8). */
export const SMART_STRAIGHT_DISTANCE = 40;
/** Axis tolerance for "these two cards are aligned". */
export const SMART_ALIGN_TOLERANCE = 24;
/** Categories whose relationships read better as right angles (07 §7.8). */
export const ORTHOGONAL_CATEGORIES: readonly EdgeCategory[] = [
  'infrastructure',
  'code',
  'temporal',
];

export type ResolvedSmartMode = 'straight' | 'curved' | 'orthogonal';

export interface SmartDecision {
  readonly mode: ResolvedSmartMode;
  /** Number of foreign boxes in the corridor, as counted for the decision. */
  readonly obstacles: number;
  /**
   * Perpendicular push for the auto-waypoint the "few obstacles" branch inserts. `null` when the
   * chosen branch does not need one. Auto-waypoints are geometry, never document data.
   */
  readonly autoWaypointPush: number | null;
}

export interface SmartInput {
  readonly source: NodeBox;
  readonly target: NodeBox;
  readonly category?: EdgeCategory | undefined;
  readonly obstacles?: ObstacleSource | undefined;
}

/** Bounding box of the direct corridor between the two cards. */
export function corridorBBox(source: NodeBox, target: NodeBox): BBox {
  const a = centerOf(source);
  const b = centerOf(target);
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** Boxes in the corridor that are neither endpoint. */
export function countObstacles(input: SmartInput): number {
  const source = input.obstacles;
  if (source === undefined) return 0;
  const bbox = corridorBBox(input.source, input.target);
  let count = 0;
  for (const box of source.query(bbox)) {
    if (box.id === input.source.id || box.id === input.target.id) continue;
    if (overlaps(bbox, boxToBBox(box))) count += 1;
  }
  return count;
}

function overlaps(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function chooseSmartMode(input: SmartInput): SmartDecision {
  const a: Point = centerOf(input.source);
  const b: Point = centerOf(input.target);
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const aligned =
    Math.abs(b.x - a.x) < SMART_ALIGN_TOLERANCE || Math.abs(b.y - a.y) < SMART_ALIGN_TOLERANCE;
  const obstacles = countObstacles(input);

  if (d < SMART_STRAIGHT_DISTANCE) return { mode: 'straight', obstacles, autoWaypointPush: null };
  if (aligned && obstacles === 0) return { mode: 'straight', obstacles, autoWaypointPush: null };
  if (obstacles === 0) return { mode: 'curved', obstacles, autoWaypointPush: null };
  if (obstacles <= 2) {
    const category = input.category;
    if (category !== undefined && ORTHOGONAL_CATEGORIES.includes(category)) {
      return { mode: 'orthogonal', obstacles, autoWaypointPush: null };
    }
    return { mode: 'curved', obstacles, autoWaypointPush: 40 + 12 * obstacles };
  }
  return { mode: 'orthogonal', obstacles, autoWaypointPush: null };
}

/** Any edge shorter than 40 screen px is drawn straight, whatever the mode says (07 §7.2). */
export function degradesToStraight(worldLength: number, zoom: number): boolean {
  return worldLength * zoom < STRAIGHT_DEGRADE_LENGTH;
}
