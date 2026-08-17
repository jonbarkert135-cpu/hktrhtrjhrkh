/**
 * Viewport culling and DOM promotion (05_CANVAS_ENGINE.md §6.10, P2 requirement 5).
 *
 * Pure functions over a `SceneQuery`: no engine state, no DOM, so both the renderer and the tests
 * can call them with plain rects.
 */

import type { NodeId, NodeView, Rect, SceneQuery, Vec2 } from '../types';
import {
  CULL_MARGIN_MAX,
  CULL_MARGIN_MIN,
  CULL_MARGIN_RATIO,
  LOD_THRESHOLDS,
  MAX_DOM_NODES,
} from '../constants';

/** Extra lead margin is capped here so a fast fling cannot inflate the query to the whole scene. */
const MAX_LEAD_MARGIN = 1024;
/** World px of lead per world px/frame of pan velocity (§6.10). */
const LEAD_PER_VELOCITY = 8;

const ZERO_VELOCITY: Vec2 = { x: 0, y: 0 };

/**
 * `viewportWorld` inflated by the margin ring, biased in the direction of travel so nodes are
 * already mounted when they scroll in. `panVelocity` is world px per frame.
 */
export function cullRect(viewportWorld: Rect, panVelocity: Vec2 = ZERO_VELOCITY): Rect {
  const margin = Math.min(
    CULL_MARGIN_MAX,
    Math.max(CULL_MARGIN_MIN, CULL_MARGIN_RATIO * viewportWorld.w),
  );
  const vx = Number.isFinite(panVelocity.x) ? panVelocity.x : 0;
  const vy = Number.isFinite(panVelocity.y) ? panVelocity.y : 0;
  const speed = Math.hypot(vx, vy);
  const lead = margin + Math.min(MAX_LEAD_MARGIN, speed * LEAD_PER_VELOCITY);

  const left = vx < 0 ? lead : margin;
  const right = vx > 0 ? lead : margin;
  const top = vy < 0 ? lead : margin;
  const bottom = vy > 0 ? lead : margin;

  return {
    x: viewportWorld.x - left,
    y: viewportWorld.y - top,
    w: viewportWorld.w + left + right,
    h: viewportWorld.h + top + bottom,
  };
}

export interface PromotionPlan {
  /** Nodes to mount as DOM hosts, nearest to the viewport centre first. */
  ids: NodeId[];
  /** True when candidates were dropped by `MAX_DOM_NODES` (telemetry: `overlay-budget-exceeded`). */
  budgetExceeded: boolean;
}

/**
 * Nodes eligible for DOM promotion inside `cull`, truncated at the overlay budget. Below the `dom`
 * LOD threshold nothing is promoted at all: the scene canvas paints glyphs instead (§6.8).
 *
 * `stableZoom` must be the quantized zoom (requirement 7), never the raw camera zoom, otherwise a
 * continuous gesture thrashes mount/unmount.
 */
export function promotionCandidates(
  query: SceneQuery,
  cull: Rect,
  stableZoom: number,
  budget: number = MAX_DOM_NODES,
): PromotionPlan {
  if (!(stableZoom >= LOD_THRESHOLDS.dom)) return { ids: [], budgetExceeded: false };

  // The centre of the (already lead-biased) cull rect: the ranking should favour what the user is
  // panning towards, which is exactly where the bias moved the centre.
  const cx = cull.x + cull.w / 2;
  const cy = cull.y + cull.h / 2;
  const scored = query.nodesIn(cull).map((n: NodeView) => {
    const dx = n.x + n.w / 2 - cx;
    const dy = n.y + n.h / 2 - cy;
    return { id: n.id, d2: dx * dx + dy * dy };
  });
  scored.sort((a, b) => a.d2 - b.d2 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const limit = Math.max(0, Math.min(budget, scored.length));
  return {
    ids: scored.slice(0, limit).map((s) => s.id),
    budgetExceeded: scored.length > limit,
  };
}
