/**
 * Self-loops (07_EDGE_SYSTEM.md §7.5): an edge whose source and target are the same node. Multiple
 * self-edges walk the four sides in turn and then grow concentrically, so ten self-loops on one
 * card are still individually clickable.
 */

import { add, scale } from './geometry.ts';
import { portPoint, sideNormal, sideTangent } from './ports.ts';
import type { NodeBox, PathCommand, PortSide } from './types.ts';

const SIDE_CYCLE: readonly PortSide[] = ['right', 'top', 'left', 'bottom'];
/** Radius of the first ring, and the growth per completed cycle (07 §7.5). */
export const SELF_LOOP_RADIUS = 34;
export const SELF_LOOP_RING_STEP = 18;

export function selfLoopSide(index: number): PortSide {
  return SIDE_CYCLE[
    ((index % SIDE_CYCLE.length) + SIDE_CYCLE.length) % SIDE_CYCLE.length
  ] as PortSide;
}

export function selfLoopRadius(index: number): number {
  return (
    SELF_LOOP_RADIUS + Math.floor(Math.max(0, index) / SIDE_CYCLE.length) * SELF_LOOP_RING_STEP
  );
}

export function routeSelfLoop(box: NodeBox, index: number): PathCommand[] {
  const side = selfLoopSide(index);
  const r = selfLoopRadius(index);
  const p0 = portPoint(box, { side, t: 0.35 });
  const p1 = portPoint(box, { side, t: 0.65 });
  const n = sideNormal(side);
  const t = sideTangent(side);

  const c0 = add(add(p0, scale(n, r * 1.4)), scale(t, -r * 0.4));
  const c1 = add(add(p1, scale(n, r * 1.4)), scale(t, r * 0.4));
  return [
    { t: 'M', x: p0.x, y: p0.y },
    { t: 'C', x1: c0.x, y1: c0.y, x2: c1.x, y2: c1.y, x: p1.x, y: p1.y },
  ];
}
