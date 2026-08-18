/**
 * Port resolution (07_EDGE_SYSTEM.md §7.1). "Where does the line leave the card?" — answered
 * purely from the two boxes, so two clients always pick the same side for the same board.
 */

import { centerOf, dot, normalize } from './geometry.ts';
import type { NodeBox, Point, Port, PortRequest, PortSide } from './types.ts';
import { PORT_SIDES } from './types.ts';

/** Minimum dot-product advantage a new side needs to win while a node is dragged (07 §7.1). */
export const HYSTERESIS_MARGIN = 0.12;

const NORMALS: Record<PortSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** Horizontal sides win ties: cards are wider than tall, so a side exit reads better. */
const TIE_ORDER: Record<PortSide, number> = { right: 0, left: 1, top: 2, bottom: 3 };

export function sideNormal(side: PortSide): Point {
  return NORMALS[side];
}

/** Unit vector along the side, in the direction of increasing `t`. */
export function sideTangent(side: PortSide): Point {
  return side === 'top' || side === 'bottom' ? { x: 1, y: 0 } : { x: 0, y: 1 };
}

/** Length of the side in canvas units. */
export function sideLength(box: NodeBox, side: PortSide): number {
  return side === 'top' || side === 'bottom' ? box.w : box.h;
}

/** The exact point on the card border for a resolved port. */
export function portPoint(box: NodeBox, port: Port): Point {
  const t = Math.max(0, Math.min(1, port.t));
  switch (port.side) {
    case 'top':
      return { x: box.x + box.w * t, y: box.y };
    case 'bottom':
      return { x: box.x + box.w * t, y: box.y + box.h };
    case 'left':
      return { x: box.x, y: box.y + box.h * t };
    default:
      return { x: box.x + box.w, y: box.y + box.h * t };
  }
}

export interface ResolvePortOptions {
  /** `orthogonal` snaps to the side midpoint; the other modes may slide along it (07 §7.1). */
  readonly orthogonal?: boolean;
  /** The side chosen on the previous frame, for drag hysteresis. */
  readonly previous?: PortSide | undefined;
}

/**
 * Chooses the side of `self` that faces `other`, and the offset along that side.
 *
 * The offset is what keeps parallel cards from funnelling every edge through one point: the
 * perpendicular component of the direction slides the attachment along the side, clamped to
 * 0.15..0.85 so a line never touches a rounded corner.
 */
export function resolvePort(self: NodeBox, other: NodeBox, options: ResolvePortOptions = {}): Port {
  const delta: Point = {
    x: centerOf(other).x - centerOf(self).x,
    y: centerOf(other).y - centerOf(self).y,
  };
  const d = normalize(delta);

  let best: PortSide = 'right';
  let bestScore = -Infinity;
  for (const side of PORT_SIDES) {
    const score = dot(NORMALS[side], d);
    const better =
      score > bestScore + 1e-6 ||
      (Math.abs(score - bestScore) <= 1e-6 && TIE_ORDER[side] < TIE_ORDER[best]);
    if (better) {
      best = side;
      bestScore = score;
    }
  }

  // Hysteresis: keep the previous side unless the new one wins by a clear margin (07 §7.1).
  const previous = options.previous;
  if (previous !== undefined && previous !== best) {
    if (bestScore - dot(NORMALS[previous], d) < HYSTERESIS_MARGIN) best = previous;
  }

  if (options.orthogonal === true) return { side: best, t: 0.5 };

  const along = sideTangent(best);
  const len = Math.max(1, sideLength(self, best));
  const t = Math.max(0.15, Math.min(0.85, 0.5 + dot(along, delta) / (2 * len)));
  return { side: best, t };
}

/** Applies a caller-supplied port when it names a side, otherwise resolves it. */
export function materializePort(
  self: NodeBox,
  other: NodeBox,
  request: PortRequest,
  options: ResolvePortOptions = {},
): Port {
  if (request.side !== 'auto') return { side: request.side, t: request.t };
  return resolvePort(self, other, options);
}
