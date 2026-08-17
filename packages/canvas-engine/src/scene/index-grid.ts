/**
 * Uniform grid spatial index (05_CANVAS_ENGINE.md §6.2 decision, §6.3 implementation).
 *
 * A `Map<cellKey, Set<EntityId>>` plus a remembered placement span per entity. Insert/remove/update
 * are O(covered cells) — 4 cells for a typical card — which is what the drag path needs: up to 500
 * moved nodes per frame with no rebalancing and no rebuild (§6.4).
 *
 * Rect semantics are **closed**: rects that merely touch (`a.x + a.w === b.x`) count as
 * intersecting, and a point on a border is inside. Every consumer (and the brute-force oracle in
 * the property test) uses the two predicates exported here so the semantics cannot drift.
 */

import type { EntityId, Rect, Vec2 } from '../types';
import { INDEX_CELL_SIZE, MAX_WORLD_COORD, MIN_NODE_SIZE } from '../constants';

/** Objects larger than this in either axis skip the grid and live in the overflow list (§6.3). */
const OVERSIZE_FACTOR = 4;
/**
 * Above this many covered cells `queryRect` scans every entity instead: at MIN_ZOOM the viewport
 * covers ~3,268 cells, which costs more in map lookups than 5,000 AABB tests (§6.3).
 */
const MAX_CELLS_PER_QUERY = 1024;
/** Packed int cell key `cx * KEY_STRIDE + cy`; unique while `cy` stays inside one stride. */
const KEY_STRIDE = 0x100000;
const CELL_MIN = -KEY_STRIDE / 2;
const CELL_MAX = KEY_STRIDE / 2 - 1;

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function rectContainsPoint(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export interface IndexStats {
  cells: number;
  oversized: number;
  maxBucket: number;
  avgBucket: number;
}

export interface SpatialIndex {
  insert(id: EntityId, r: Rect): void;
  remove(id: EntityId): void;
  update(id: EntityId, r: Rect): void;
  /** Fills `out` (cleared first) and returns it, so callers can reuse one array per frame. */
  queryRect(r: Rect, out?: EntityId[]): EntityId[];
  queryPoint(p: Vec2, out?: EntityId[]): EntityId[];
  /** The sanitized rect the index holds for `id`, or undefined. */
  rectOf(id: EntityId): Rect | undefined;
  clear(): void;
  readonly size: number;
  stats(): IndexStats;
}

export interface GridIndexOptions {
  /** World px; defaults to `INDEX_CELL_SIZE`. */
  cellSize?: number;
  /**
   * Called at most once per index for the first entity whose size had to be clamped to
   * `MIN_NODE_SIZE` ("logged once per session", P2 §8). The engine never logs by itself.
   */
  onDegenerateRect?: (id: EntityId, original: Rect) => void;
}

interface Span {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function clampCoord(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < -MAX_WORLD_COORD ? -MAX_WORLD_COORD : v > MAX_WORLD_COORD ? MAX_WORLD_COORD : v;
}

function clampCell(v: number): number {
  return v < CELL_MIN ? CELL_MIN : v > CELL_MAX ? CELL_MAX : v;
}

export function createGridIndex(options: GridIndexOptions = {}): SpatialIndex {
  const cell = options.cellSize ?? INDEX_CELL_SIZE;
  const oversizeLimit = cell * OVERSIZE_FACTOR;
  const buckets = new Map<number, Set<EntityId>>();
  const placement = new Map<EntityId, Span>();
  const rects = new Map<EntityId, Rect>();
  const oversized = new Set<EntityId>();
  /** Reused across queries; cleared, never reallocated (§6.3). */
  const seen = new Set<EntityId>();
  let reportedDegenerate = false;

  const sanitize = (id: EntityId, r: Rect): Rect => {
    const w = Number.isFinite(r.w) && r.w >= MIN_NODE_SIZE ? r.w : MIN_NODE_SIZE;
    const h = Number.isFinite(r.h) && r.h >= MIN_NODE_SIZE ? r.h : MIN_NODE_SIZE;
    if ((w !== r.w || h !== r.h) && !reportedDegenerate) {
      reportedDegenerate = true;
      options.onDegenerateRect?.(id, r);
    }
    return { x: clampCoord(r.x), y: clampCoord(r.y), w, h };
  };

  const spanOf = (r: Rect): Span => ({
    x0: clampCell(Math.floor(r.x / cell)),
    y0: clampCell(Math.floor(r.y / cell)),
    x1: clampCell(Math.floor((r.x + r.w) / cell)),
    y1: clampCell(Math.floor((r.y + r.h) / cell)),
  });

  const addToCells = (id: EntityId, s: Span): void => {
    for (let cx = s.x0; cx <= s.x1; cx += 1) {
      for (let cy = s.y0; cy <= s.y1; cy += 1) {
        const key = cx * KEY_STRIDE + cy;
        const bucket = buckets.get(key);
        if (bucket) bucket.add(id);
        else buckets.set(key, new Set([id]));
      }
    }
  };

  const removeFromCells = (id: EntityId, s: Span): void => {
    for (let cx = s.x0; cx <= s.x1; cx += 1) {
      for (let cy = s.y0; cy <= s.y1; cy += 1) {
        const key = cx * KEY_STRIDE + cy;
        const bucket = buckets.get(key);
        if (!bucket) continue;
        bucket.delete(id);
        if (bucket.size === 0) buckets.delete(key);
      }
    }
  };

  const sameSpan = (a: Span, b: Span): boolean =>
    a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;

  const detach = (id: EntityId): void => {
    const prev = placement.get(id);
    if (prev) {
      removeFromCells(id, prev);
      placement.delete(id);
    }
    oversized.delete(id);
  };

  const attach = (id: EntityId, r: Rect): void => {
    if (r.w > oversizeLimit || r.h > oversizeLimit) {
      oversized.add(id);
      return;
    }
    const span = spanOf(r);
    addToCells(id, span);
    placement.set(id, span);
  };

  const insert = (id: EntityId, r: Rect): void => {
    const clean = sanitize(id, r);
    detach(id);
    rects.set(id, clean);
    attach(id, clean);
  };

  const scanAll = (out: EntityId[], hit: (r: Rect) => boolean): EntityId[] => {
    for (const [id, r] of rects) if (hit(r)) out.push(id);
    return out;
  };

  return {
    insert,

    update(id: EntityId, r: Rect): void {
      const clean = sanitize(id, r);
      const prev = placement.get(id);
      rects.set(id, clean);
      if (prev && clean.w <= oversizeLimit && clean.h <= oversizeLimit) {
        const next = spanOf(clean);
        // Fast path: the node moved inside the cells it already occupies (~92% of drag frames).
        if (sameSpan(prev, next)) return;
        removeFromCells(id, prev);
        addToCells(id, next);
        placement.set(id, next);
        return;
      }
      detach(id);
      attach(id, clean);
    },

    remove(id: EntityId): void {
      detach(id);
      rects.delete(id);
    },

    queryRect(r: Rect, out: EntityId[] = []): EntityId[] {
      out.length = 0;
      const span = spanOf({ x: clampCoord(r.x), y: clampCoord(r.y), w: r.w, h: r.h });
      const cells = (span.x1 - span.x0 + 1) * (span.y1 - span.y0 + 1);
      if (!Number.isFinite(cells) || cells > MAX_CELLS_PER_QUERY) {
        return scanAll(out, (rr) => rectsIntersect(rr, r));
      }
      for (let cy = span.y0; cy <= span.y1; cy += 1) {
        for (let cx = span.x0; cx <= span.x1; cx += 1) {
          const bucket = buckets.get(cx * KEY_STRIDE + cy);
          if (!bucket) continue;
          for (const id of bucket) {
            if (seen.has(id)) continue;
            seen.add(id);
            const rr = rects.get(id);
            if (rr && rectsIntersect(rr, r)) out.push(id);
          }
        }
      }
      seen.clear();
      for (const id of oversized) {
        const rr = rects.get(id);
        if (rr && rectsIntersect(rr, r)) out.push(id);
      }
      return out;
    },

    queryPoint(p: Vec2, out: EntityId[] = []): EntityId[] {
      out.length = 0;
      const cx = clampCell(Math.floor(clampCoord(p.x) / cell));
      const cy = clampCell(Math.floor(clampCoord(p.y) / cell));
      const bucket = buckets.get(cx * KEY_STRIDE + cy);
      if (bucket) {
        for (const id of bucket) {
          const rr = rects.get(id);
          if (rr && rectContainsPoint(rr, p)) out.push(id);
        }
      }
      for (const id of oversized) {
        const rr = rects.get(id);
        if (rr && rectContainsPoint(rr, p)) out.push(id);
      }
      return out;
    },

    rectOf(id: EntityId): Rect | undefined {
      return rects.get(id);
    },

    clear(): void {
      buckets.clear();
      placement.clear();
      rects.clear();
      oversized.clear();
      seen.clear();
    },

    get size(): number {
      return rects.size;
    },

    stats(): IndexStats {
      let max = 0;
      let total = 0;
      for (const bucket of buckets.values()) {
        total += bucket.size;
        if (bucket.size > max) max = bucket.size;
      }
      return {
        cells: buckets.size,
        oversized: oversized.size,
        maxBucket: max,
        avgBucket: buckets.size === 0 ? 0 : total / buckets.size,
      };
    },
  };
}
