/**
 * Edge labels: anchoring and overlap avoidance (07_EDGE_SYSTEM.md §9).
 *
 * Placement runs in screen space (that is where overlap is perceived) and stays pure: the caller
 * injects the world→screen projection and the text measurement, so the same algorithm runs in a
 * test with a fake font metric and in the browser with the real one.
 */

import { pointAtFraction } from './geometry.ts';
import type { EdgeGeometry, OrientedPoint, Point } from './types.ts';

/** Slide and push offsets tried in order, per 07 §9.2. */
export const LABEL_T_OFFSETS: readonly number[] = [0, -0.12, 0.12, -0.24, 0.24, -0.36, 0.36];
export const LABEL_PERP_OFFSETS: readonly number[] = [0, -14, 14, -26, 26];
/** Uniform-hash cell, screen px. */
export const LABEL_CELL_W = 48;
export const LABEL_CELL_H = 24;
/** Beyond this many labels per frame only selected/hovered ones are drawn (07 §9.2). */
export const LABEL_BUDGET = 250;
/** Truncation limits by LOD (07 §9.1). */
export const LABEL_MAX_CHARS_L2 = 28;
export const LABEL_MAX_CHARS_L3 = 48;

/** The label anchor in world units: a point along the path plus an edge-local offset (07 §9.1). */
export function labelAnchor(
  geometry: EdgeGeometry,
  t: number,
  offset: Point = { x: 0, y: 0 },
): OrientedPoint {
  const base = pointAtFraction(geometry.flat, t);
  const cos = Math.cos(base.angle);
  const sin = Math.sin(base.angle);
  // Edge-local frame: x runs along the path, y is the left-hand perpendicular.
  return {
    x: base.x + offset.x * cos - offset.y * sin,
    y: base.y + offset.x * sin + offset.y * cos,
    angle: base.angle,
  };
}

export function truncateLabel(text: string, maxChars: number): string {
  const chars = [...text];
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, Math.max(1, maxChars - 1)).join('')}…`;
}

export interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LabelCandidate {
  readonly id: string;
  readonly text: string;
  readonly geometry: EdgeGeometry;
  /** Base position along the path, 0..1. */
  readonly t: number;
  readonly selected?: boolean;
  readonly hovered?: boolean;
  /** 0 = unverified … 2 = confirmed; higher wins (07 §9.2 priority order). */
  readonly confidenceRank?: number;
  readonly weight?: number;
}

export interface PlaceLabelsOptions {
  /** World → screen projection, injected so this module never touches a camera. */
  readonly toScreen: (p: Point) => Point;
  /** Measured size of the chip in screen px. */
  readonly measure: (candidate: LabelCandidate) => { w: number; h: number };
  /** Screen boxes labels must not cover — the visible node cards (07 §9.2). */
  readonly nodeBoxes?: readonly ScreenBox[];
  readonly budget?: number;
}

export interface PlacedLabel {
  readonly id: string;
  readonly box: ScreenBox;
  readonly t: number;
  /** True when nothing fit and only the 3 px dot fallback should be drawn (07 §9.2). */
  readonly dotFallback: boolean;
}

/** Priority order of 07 §9.2: selected > hovered > confidence > weight > id. */
export function compareLabelPriority(a: LabelCandidate, b: LabelCandidate): number {
  const flag = (c: LabelCandidate): number =>
    c.selected === true ? 2 : c.hovered === true ? 1 : 0;
  if (flag(a) !== flag(b)) return flag(b) - flag(a);
  const conf = (c: LabelCandidate): number => c.confidenceRank ?? 0;
  if (conf(a) !== conf(b)) return conf(b) - conf(a);
  const weight = (c: LabelCandidate): number => c.weight ?? 0;
  if (weight(a) !== weight(b)) return weight(b) - weight(a);
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Places as many labels as fit, sliding each one along its edge and pushing it off the path before
 * giving up. O(k · 35) with O(1) grid tests, and the grid is rebuilt per frame — cheaper than
 * keeping it in sync with a camera that moves every frame.
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  options: PlaceLabelsOptions,
): PlacedLabel[] {
  const budget = options.budget ?? LABEL_BUDGET;
  const sorted = [...candidates].sort(compareLabelPriority);
  const considered = sorted.slice(0, budget);
  const grid = new UniformHash(LABEL_CELL_W, LABEL_CELL_H);
  for (const box of options.nodeBoxes ?? []) grid.insert(box);

  const placed: PlacedLabel[] = [];
  for (const candidate of considered) {
    const size = options.measure(candidate);
    let committed: PlacedLabel | null = null;
    for (const dt of LABEL_T_OFFSETS) {
      const t = clamp01(candidate.t + dt);
      for (const perp of LABEL_PERP_OFFSETS) {
        const anchor = pointAtFraction(candidate.geometry.flat, t);
        const screen = options.toScreen({ x: anchor.x, y: anchor.y });
        const nx = -Math.sin(anchor.angle);
        const ny = Math.cos(anchor.angle);
        const box: ScreenBox = {
          x: screen.x + nx * perp - size.w / 2,
          y: screen.y + ny * perp - size.h / 2,
          w: size.w,
          h: size.h,
        };
        if (grid.isFree(box)) {
          grid.insert(box);
          committed = { id: candidate.id, box, t, dotFallback: false };
          break;
        }
      }
      if (committed !== null) break;
    }
    if (committed === null) {
      const anchor = pointAtFraction(candidate.geometry.flat, candidate.t);
      const screen = options.toScreen({ x: anchor.x, y: anchor.y });
      committed = {
        id: candidate.id,
        box: { x: screen.x, y: screen.y, w: 3, h: 3 },
        t: candidate.t,
        dotFallback: true,
      };
    }
    placed.push(committed);
  }
  return placed;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Uniform spatial hash over screen boxes; overlap tests are O(cells covered). */
export class UniformHash {
  private readonly cells = new Map<string, ScreenBox[]>();

  constructor(
    private readonly cellW: number,
    private readonly cellH: number,
  ) {}

  insert(box: ScreenBox): void {
    for (const key of this.keysFor(box)) {
      const bucket = this.cells.get(key);
      if (bucket === undefined) this.cells.set(key, [box]);
      else bucket.push(box);
    }
  }

  isFree(box: ScreenBox): boolean {
    for (const key of this.keysFor(box)) {
      for (const other of this.cells.get(key) ?? []) {
        if (overlaps(box, other)) return false;
      }
    }
    return true;
  }

  private keysFor(box: ScreenBox): string[] {
    const keys: string[] = [];
    const x0 = Math.floor(box.x / this.cellW);
    const x1 = Math.floor((box.x + box.w) / this.cellW);
    const y0 = Math.floor(box.y / this.cellH);
    const y1 = Math.floor((box.y + box.h) / this.cellH);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) keys.push(`${x}:${y}`);
    }
    return keys;
  }
}

function overlaps(a: ScreenBox, b: ScreenBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
