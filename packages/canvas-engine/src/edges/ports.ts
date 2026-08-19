/**
 * Connection ports: the 10 px band around a card border that starts an edge (20_ROADMAP P5 §5.3,
 * 07_EDGE_SYSTEM.md §6.1).
 *
 * Pure geometry, no DOM and no domain imports: the band is expressed in *screen* px and divided by
 * the zoom, so the affordance keeps a constant physical size while the card grows and shrinks.
 */

import { PORT_BAND_PX } from '../constants';
import type { AnchorSpec, NodeView, Vec2 } from '../types';

type Side = 'top' | 'right' | 'bottom' | 'left';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The port under a world point, or `null` when the point is not in the band. The band straddles
 * the border: `PORT_BAND_PX` inwards *and* outwards, so a pointer that overshoots the card by a
 * pixel still grabs the port instead of the canvas.
 */
export function portAt(node: NodeView, world: Vec2, zoom: number): AnchorSpec | null {
  if (node.locked || node.hidden) return null;
  // The band is a screen-px constant, but never more than a quarter of the card: on a small card
  // an uncapped band would swallow the interior and make the card undraggable.
  const band = Math.min(
    PORT_BAND_PX / Math.max(zoom, 1e-3),
    Math.max(Math.min(Math.max(node.w, 0), Math.max(node.h, 0)) / 4, 1),
  );
  const left = node.x;
  const top = node.y;
  const right = node.x + Math.max(node.w, 0);
  const bottom = node.y + Math.max(node.h, 0);
  const width = Math.max(right - left, 1e-6);
  const height = Math.max(bottom - top, 1e-6);

  // Outside the card the side is the one the point overshot; inside it is the nearest border. Two
  // separate rules, because "nearest border" outside a card picks absurd sides at low zoom, where
  // the band is wider than the card itself.
  const outX = world.x < left ? left - world.x : world.x > right ? world.x - right : 0;
  const outY = world.y < top ? top - world.y : world.y > bottom ? world.y - bottom : 0;

  let side: Side;
  if (outX > 0 || outY > 0) {
    if (Math.hypot(outX, outY) > band) return null;
    side = outX >= outY ? (world.x < left ? 'left' : 'right') : world.y < top ? 'top' : 'bottom';
  } else {
    const dLeft = world.x - left;
    const dRight = right - world.x;
    const dTop = world.y - top;
    const dBottom = bottom - world.y;
    const nearest = Math.min(dLeft, dRight, dTop, dBottom);
    if (nearest > band) return null;
    // Ties go clockwise from the top, which is also the order a keyboard user cycles them in.
    side =
      nearest === dTop
        ? 'top'
        : nearest === dRight
          ? 'right'
          : nearest === dBottom
            ? 'bottom'
            : 'left';
  }

  const t =
    side === 'top' || side === 'bottom'
      ? clamp01((world.x - left) / width)
      : clamp01((world.y - top) / height);
  return { side, t };
}

/** Where a resolved anchor sits on the card border; `auto` resolves to the centre of the card. */
export function portPoint(node: NodeView, anchor: AnchorSpec): Vec2 {
  const w = Math.max(node.w, 0);
  const h = Math.max(node.h, 0);
  const t = clamp01(anchor.t);
  switch (anchor.side) {
    case 'top':
      return { x: node.x + w * t, y: node.y };
    case 'bottom':
      return { x: node.x + w * t, y: node.y + h };
    case 'left':
      return { x: node.x, y: node.y + h * t };
    case 'right':
      return { x: node.x + w, y: node.y + h * t };
    case 'auto':
      return { x: node.x + w / 2, y: node.y + h / 2 };
  }
}

/**
 * The port a free-hand pointer implies: the side of `node` facing `towards`. Used for the pending
 * end of a connection, where the user has not chosen a side yet.
 */
export function facingPort(node: NodeView, towards: Vec2): AnchorSpec {
  const w = Math.max(node.w, 1e-6);
  const h = Math.max(node.h, 1e-6);
  const cx = node.x + w / 2;
  const cy = node.y + h / 2;
  const dx = (towards.x - cx) / w;
  const dy = (towards.y - cy) / h;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { side: dx >= 0 ? 'right' : 'left', t: clamp01((towards.y - node.y) / h) };
  }
  return { side: dy >= 0 ? 'bottom' : 'top', t: clamp01((towards.x - node.x) / w) };
}
