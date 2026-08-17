/**
 * Grid snap, object/alignment snap and distribution guides (05_CANVAS_ENGINE.md §7.8,
 * roadmap P2 requirement 12).
 *
 * Everything here is evaluated for the **dragged bounding box only**, never per node: with 500
 * nodes selected, per-node snapping is both wrong (the selection would deform) and slow.
 */

import type { NodeId, NodeView, Rect, Vec2 } from '../types';
import { GRID_SNAP, SNAP_CANDIDATE_LIMIT, SNAP_TOL_PX } from '../constants';

/** How far past the involved bounds a guide line is drawn, in world px (05 §7.8). */
export const GUIDE_EXTEND_PX = 24;

export interface GuideLine {
  /** 'x' is a vertical line at world x = `pos`; 'y' is a horizontal line at world y = `pos`. */
  axis: 'x' | 'y';
  pos: number;
  /** Extent along the other axis, already inflated by GUIDE_EXTEND_PX. */
  from: number;
  to: number;
  kind: 'align' | 'distribute';
  /** Gap in world px for distribution guides; null for alignment guides. */
  gap: number | null;
}

export interface SnapInput {
  /** Pre-gesture bounding box of the dragged selection, world px. */
  box: Rect;
  /** Raw pointer delta, world px. */
  delta: Vec2;
  /** Nodes that may contribute guide lines; the moving ones are filtered out here. */
  candidates: readonly NodeView[];
  moving: ReadonlySet<NodeId>;
  zoom: number;
  /** Grid snap is a user setting (`EngineFeatures.snapToGrid`), off by default. */
  gridSnap: boolean;
  /** Alignment/distribution guides (`EngineFeatures.alignmentGuides`), on by default. */
  objectSnap: boolean;
  /** Ctrl/Cmd held: all snapping is suspended for this frame (05 §7.8). */
  suspend: boolean;
}

export interface SnapResult {
  /** Snapped delta, world px. */
  delta: Vec2;
  guides: readonly GuideLine[];
}

interface Line {
  /** Position along the snapping axis. */
  pos: number;
  /** Extent along the perpendicular axis, used to draw the guide. */
  lo: number;
  hi: number;
}

const linesX = (r: Rect): [Line, Line, Line] => [
  { pos: r.x, lo: r.y, hi: r.y + r.h },
  { pos: r.x + r.w / 2, lo: r.y, hi: r.y + r.h },
  { pos: r.x + r.w, lo: r.y, hi: r.y + r.h },
];

const linesY = (r: Rect): [Line, Line, Line] => [
  { pos: r.y, lo: r.x, hi: r.x + r.w },
  { pos: r.y + r.h / 2, lo: r.x, hi: r.x + r.w },
  { pos: r.y + r.h, lo: r.x, hi: r.x + r.w },
];

const rectOf = (n: NodeView): Rect => ({ x: n.x, y: n.y, w: n.w, h: n.h });
const centerX = (r: Rect): number => r.x + r.w / 2;
const centerY = (r: Rect): number => r.y + r.h / 2;

const distanceSq = (a: Rect, b: Rect): number => {
  const dx = centerX(a) - centerX(b);
  const dy = centerY(a) - centerY(b);
  return dx * dx + dy * dy;
};

/** Nearest SNAP_CANDIDATE_LIMIT candidates to the moved box, moving nodes excluded. */
function nearest(
  moved: Rect,
  candidates: readonly NodeView[],
  moving: ReadonlySet<NodeId>,
): Rect[] {
  const scored: Array<{ rect: Rect; d: number }> = [];
  for (const node of candidates) {
    if (moving.has(node.id) || node.hidden) continue;
    const rect = rectOf(node);
    scored.push({ rect, d: distanceSq(moved, rect) });
  }
  // ponytail: full sort instead of a partial selection. n is already viewport-capped; upgrade to a
  // bounded max-heap only if a profile shows this on the drag hot path.
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, SNAP_CANDIDATE_LIMIT).map((s) => s.rect);
}

interface AxisSnap {
  /** Correction added to the raw delta on this axis. */
  adjust: number;
  guide: GuideLine;
}

/** Smallest |delta| per axis wins; ties break toward the nearest node (candidates are pre-sorted). */
function alignAxis(
  axis: 'x' | 'y',
  moved: Rect,
  candidates: readonly Rect[],
  zoom: number,
): AxisSnap | null {
  const of = axis === 'x' ? linesX : linesY;
  const movedLines = of(moved);
  const tol = SNAP_TOL_PX / zoom;
  let best: { adjust: number; abs: number; a: Line; b: Line } | null = null;

  for (const cand of candidates) {
    for (const c of of(cand)) {
      for (const m of movedLines) {
        const d = c.pos - m.pos;
        const abs = Math.abs(d);
        if (abs > tol) continue;
        if (best === null || abs < best.abs - 1e-9) best = { adjust: d, abs, a: m, b: c };
      }
    }
  }
  if (best === null) return null;
  const lo = Math.min(best.a.lo, best.b.lo) - GUIDE_EXTEND_PX;
  const hi = Math.max(best.a.hi, best.b.hi) + GUIDE_EXTEND_PX;
  return {
    adjust: best.adjust,
    guide: { axis, pos: best.b.pos, from: lo, to: hi, kind: 'align', gap: null },
  };
}

/**
 * Distribution: ≥ 3 boxes (the dragged one plus ≥ 2 neighbours) with equal gaps. The dragged box is
 * offered the position that continues the rhythm on the side where the rhythm exists.
 */
function distributeAxis(
  axis: 'x' | 'y',
  moved: Rect,
  candidates: readonly Rect[],
  zoom: number,
): AxisSnap | null {
  const start = (r: Rect): number => (axis === 'x' ? r.x : r.y);
  const end = (r: Rect): number => (axis === 'x' ? r.x + r.w : r.y + r.h);
  const crossLo = (r: Rect): number => (axis === 'x' ? r.y : r.x);
  const crossHi = (r: Rect): number => (axis === 'x' ? r.y + r.h : r.x + r.w);
  const tol = SNAP_TOL_PX / zoom;

  // Only boxes that overlap on the perpendicular axis are part of the same visual row/column.
  const row = candidates
    .filter((c) => crossHi(c) > crossLo(moved) && crossLo(c) < crossHi(moved))
    .sort((a, b) => start(a) - start(b));
  if (row.length < 2) return null;

  for (let i = 0; i + 1 < row.length; i += 1) {
    const a = row[i];
    const b = row[i + 1];
    if (a === undefined || b === undefined) continue;
    const gap = start(b) - end(a);
    if (gap <= 0) continue;

    for (const target of [end(b) + gap, start(a) - gap - (end(moved) - start(moved))]) {
      const adjust = target - start(moved);
      if (Math.abs(adjust) > tol) continue;
      const lo = Math.min(crossLo(a), crossLo(b), crossLo(moved));
      const hi = Math.max(crossHi(a), crossHi(b), crossHi(moved));
      return {
        adjust,
        guide: {
          axis,
          pos: target,
          from: lo - GUIDE_EXTEND_PX,
          to: hi + GUIDE_EXTEND_PX,
          kind: 'distribute',
          gap,
        },
      };
    }
  }
  return null;
}

const snapToGrid = (v: number): number => Math.round(v / GRID_SNAP) * GRID_SNAP;

/**
 * Returns the delta to actually apply plus the guides to draw. Grid snap is applied first; an
 * object/distribution snap on an axis overrides the grid on that axis, because a guide the user can
 * see beats an invisible lattice.
 */
export function snapDrag(input: SnapInput): SnapResult {
  const { box, delta, zoom } = input;
  if (input.suspend) return { delta, guides: [] };

  let dx = delta.x;
  let dy = delta.y;

  if (input.gridSnap) {
    dx = snapToGrid(box.x + dx) - box.x;
    dy = snapToGrid(box.y + dy) - box.y;
  }

  if (!input.objectSnap) return { delta: { x: dx, y: dy }, guides: [] };

  const raw: Rect = { x: box.x + delta.x, y: box.y + delta.y, w: box.w, h: box.h };
  const candidates = nearest(raw, input.candidates, input.moving);
  const guides: GuideLine[] = [];

  const sx = alignAxis('x', raw, candidates, zoom) ?? distributeAxis('x', raw, candidates, zoom);
  if (sx !== null) {
    dx = delta.x + sx.adjust;
    guides.push(sx.guide);
  }
  const sy = alignAxis('y', raw, candidates, zoom) ?? distributeAxis('y', raw, candidates, zoom);
  if (sy !== null) {
    dy = delta.y + sy.adjust;
    guides.push(sy.guide);
  }

  return { delta: { x: dx, y: dy }, guides };
}
