/**
 * Orthogonal routing (07_EDGE_SYSTEM.md §7.7): axis-aligned paths that avoid the cards in between.
 *
 * The search runs on a **Hanan grid** — the lattice induced by the interesting x and y coordinates
 * (obstacle borders plus the endpoints) — not on a dense raster. On an infinite canvas a raster is
 * unaffordable; the lattice is `|xs| × |ys|` with `|xs|, |ys| ≈ 2 · obstacles + 4`, and it provably
 * contains an optimal rectilinear path when one exists.
 */

import { boxToBBox, inflate } from './geometry.ts';
import type { BBox, NodeBox, PathCommand, Point } from './types.ts';
import { CLEARANCE } from './types.ts';

let gScoreScratch = new Float64Array(0);
let cameFromScratch = new Int32Array(0);
let closedScratch = new Uint8Array(0);

function scratchF64(size: number): Float64Array {
  if (gScoreScratch.length < size) gScoreScratch = new Float64Array(size);
  gScoreScratch.fill(Infinity, 0, size);
  return gScoreScratch;
}

function scratchI32(size: number): Int32Array {
  if (cameFromScratch.length < size) cameFromScratch = new Int32Array(size);
  cameFromScratch.fill(-1, 0, size);
  return cameFromScratch;
}

function scratchU8(size: number): Uint8Array {
  if (closedScratch.length < size) closedScratch = new Uint8Array(size);
  closedScratch.fill(0, 0, size);
  return closedScratch;
}

/** Cost knobs from 07 §7.7. */
export const TURN_PENALTY = 30;
/** Search budget: expansions, and the wall-clock ceiling that ends a pathological board. */
export const EXPANSION_BUDGET = 4000;
export const TIME_BUDGET_MS = 6;
/** Segments snap to this lane pitch so parallel edges line up (07 §7.7 post-process 3). */
export const LANE_PITCH = 6;
/** Nodes further than this from the endpoint box are irrelevant to the route (07 §7.7). */
export const REGION_MARGIN = 240;

export interface ObstacleGrid {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** `blocked[iy * xs.length + ix]` — the lattice point lies inside an inflated obstacle. */
  readonly blocked: Uint8Array;
  readonly boxes: readonly BBox[];
}

/** The region the router cares about: the endpoint box, inflated (07 §7.7). */
export function routingRegion(p0: Point, p1: Point, margin = REGION_MARGIN): BBox {
  return inflate(
    {
      minX: Math.min(p0.x, p1.x),
      minY: Math.min(p0.y, p1.y),
      maxX: Math.max(p0.x, p1.x),
      maxY: Math.max(p0.y, p1.y),
    },
    margin,
  );
}

/** The obstacle rectangles a route must stay out of: card boxes grown by the clearance. */
export function inflateBoxes(boxes: readonly NodeBox[], clearance = CLEARANCE): BBox[] {
  return boxes.map((b) => inflate(boxToBBox(b), clearance));
}

export function buildObstacleGrid(
  region: BBox,
  boxes: readonly NodeBox[],
  p0: Point,
  p1: Point,
  clearance = CLEARANCE,
): ObstacleGrid {
  const inflated = inflateBoxes(boxes, clearance);
  const xs = uniqueSorted([
    region.minX,
    region.maxX,
    p0.x,
    p1.x,
    ...inflated.flatMap((b) => [b.minX, b.maxX]),
  ]);
  const ys = uniqueSorted([
    region.minY,
    region.maxY,
    p0.y,
    p1.y,
    ...inflated.flatMap((b) => [b.minY, b.maxY]),
  ]);

  // Marking is done per obstacle over its own lattice window, not per lattice point over all
  // obstacles: the naive form is O(|xs| · |ys| · N) ≈ O(N³) and dominates the whole router on a
  // dense board. Each box only touches the coordinates strictly inside it, found by binary search.
  const blocked = new Uint8Array(xs.length * ys.length);
  for (const b of inflated) {
    const ix0 = firstStrictlyGreater(xs, b.minX);
    const ix1 = lastStrictlyLess(xs, b.maxX);
    if (ix0 > ix1) continue;
    const iy0 = firstStrictlyGreater(ys, b.minY);
    const iy1 = lastStrictlyLess(ys, b.maxY);
    if (iy0 > iy1) continue;
    for (let iy = iy0; iy <= iy1; iy += 1) {
      blocked.fill(1, iy * xs.length + ix0, iy * xs.length + ix1 + 1);
    }
  }
  return { xs, ys, blocked, boxes: inflated };
}

/** Index of the first value strictly greater than `v` (sorted ascending, epsilon-tolerant). */
function firstStrictlyGreater(values: readonly number[], v: number): number {
  const eps = 1e-6;
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] as number) > v + eps) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Index of the last value strictly less than `v` (sorted ascending, epsilon-tolerant). */
function lastStrictlyLess(values: readonly number[], v: number): number {
  const eps = 1e-6;
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] as number) < v - eps) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function uniqueSorted(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || Math.abs(last - v) > 1e-6) out.push(v);
  }
  return out;
}

/**
 * Does the axis-aligned segment `a→b` cross the interior of any inflated obstacle?
 *
 * A segment is a degenerate rectangle (zero height or zero width), so the naive "do the two boxes
 * overlap in area" test would always say no. Horizontal and vertical runs are therefore tested
 * explicitly: grazing a border is allowed, crossing the interior is not.
 */
export function segmentBlocked(grid: ObstacleGrid, a: Point, b: Point): boolean {
  return segmentBlockedBoxes(grid.boxes, a, b);
}

/** The same test against bare inflated boxes, so a caller can probe before building a lattice. */
export function segmentBlockedBoxes(boxes: readonly BBox[], a: Point, b: Point): boolean {
  const eps = 1e-6;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const horizontal = Math.abs(a.y - b.y) < eps;
  const vertical = Math.abs(a.x - b.x) < eps;
  // A hot loop: written imperatively (no closure per call) because A* asks this per expansion.
  for (const box of boxes) {
    const spanX = Math.min(maxX, box.maxX) - Math.max(minX, box.minX);
    const spanY = Math.min(maxY, box.maxY) - Math.max(minY, box.minY);
    if (spanX <= eps && spanY <= eps) continue;
    if (horizontal) {
      if (spanX > eps && a.y > box.minY + eps && a.y < box.maxY - eps) return true;
      continue;
    }
    if (vertical) {
      if (spanY > eps && a.x > box.minX + eps && a.x < box.maxX - eps) return true;
      continue;
    }
    if (spanX > eps && spanY > eps) return true;
  }
  return false;
}

/**
 * The cheap rectilinear shapes a human would try first: the two L-routes and the two Z-routes.
 * Trying them before A\* is what keeps a full-board relayout affordable — on a real canvas most
 * edges have a clear L or Z and never need a search at all (07 §7.7 "search only when needed").
 */
export function cheapCandidates(p0: Point, p1: Point): Point[][] {
  const dx = Math.abs(p1.x - p0.x);
  const dy = Math.abs(p1.y - p0.y);
  if (dx < 1e-6 || dy < 1e-6) return [[p0, p1]];
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const zHorizontal = [p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1];
  const zVertical = [p0, { x: p0.x, y: my }, { x: p1.x, y: my }, p1];
  const lHorizontal = [p0, { x: p1.x, y: p0.y }, p1];
  const lVertical = [p0, { x: p0.x, y: p1.y }, p1];
  return dx >= dy
    ? [zHorizontal, lHorizontal, lVertical, zVertical]
    : [zVertical, lVertical, lHorizontal, zHorizontal];
}

/** The first cheap candidate that clears every obstacle, or `null` when the search is needed. */
export function firstClearRoute(
  obstacles: ObstacleGrid | readonly BBox[],
  p0: Point,
  p1: Point,
): Point[] | null {
  const boxes = Array.isArray(obstacles) ? obstacles : (obstacles as ObstacleGrid).boxes;
  for (const candidate of cheapCandidates(p0, p1)) {
    let clear = true;
    for (let i = 1; i < candidate.length; i += 1) {
      if (segmentBlockedBoxes(boxes, candidate[i - 1] as Point, candidate[i] as Point)) {
        clear = false;
        break;
      }
    }
    if (clear) return candidate;
  }
  return null;
}

export interface OrthogonalResult {
  readonly points: Point[];
  /** True when the budget ran out and the Z-fallback was used instead (07 §7.7). */
  readonly degraded: boolean;
}

/**
 * A\* over the lattice. Nodes are lattice points, moves go to the four neighbours, and a turn
 * costs {@link TURN_PENALTY} so the result has as few corners as a human would draw.
 */
export function routeOrthogonal(
  grid: ObstacleGrid,
  from: Point,
  to: Point,
  now: () => number = () => Date.now(),
): OrthogonalResult {
  const { xs, ys } = grid;
  const start = nearestLattice(grid, from);
  const goal = nearestLattice(grid, to);
  const w = xs.length;
  const size = w * ys.length;
  if (size === 0) return { points: zRoute(from, to), degraded: true };

  const index = (ix: number, iy: number): number => iy * w + ix;
  // Scratch buffers are reused across routes: a board-wide relayout calls this thousands of times
  // per frame and fresh typed arrays would dominate the budget in GC alone.
  const gScore = scratchF64(size);
  const cameFrom = scratchI32(size);
  const closed = scratchU8(size);
  const heap = new BinaryHeap();

  const startIdx = index(start.ix, start.iy);
  const goalIdx = index(goal.ix, goal.iy);
  gScore[startIdx] = 0;
  heap.push(startIdx, heuristic(grid, start, goal));

  const deadline = now() + TIME_BUDGET_MS;
  let expansions = 0;
  let found = false;

  while (heap.size > 0) {
    const current = heap.pop();
    if (current === goalIdx) {
      found = true;
      break;
    }
    if (closed[current] === 1) continue;
    closed[current] = 1;
    expansions += 1;
    if (expansions > EXPANSION_BUDGET || now() > deadline) break;

    const ix = current % w;
    const iy = Math.floor(current / w);
    const cur: Point = { x: xs[ix] as number, y: ys[iy] as number };
    const prev = cameFrom[current] as number;

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = ix + dx;
      const ny = iy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= ys.length) continue;
      const nIdx = index(nx, ny);
      if (grid.blocked[nIdx] === 1 || closed[nIdx] === 1) continue;
      const next: Point = { x: xs[nx] as number, y: ys[ny] as number };
      if (segmentBlocked(grid, cur, next)) continue;

      const turn = prev >= 0 && isTurn(w, prev, current, nIdx) ? TURN_PENALTY : 0;
      const tentative =
        (gScore[current] as number) + Math.hypot(next.x - cur.x, next.y - cur.y) + turn;
      if (tentative >= (gScore[nIdx] as number)) continue;
      gScore[nIdx] = tentative;
      cameFrom[nIdx] = current;
      heap.push(nIdx, tentative + heuristic(grid, { ix: nx, iy: ny }, goal));
    }
  }

  if (!found) return { points: zRoute(from, to), degraded: true };

  const path: Point[] = [];
  for (let at = goalIdx; at !== -1; at = cameFrom[at] as number) {
    const ix = at % w;
    const iy = Math.floor(at / w);
    path.push({ x: xs[ix] as number, y: ys[iy] as number });
    if (at === startIdx) break;
  }
  path.reverse();
  const full = [from, ...path, to];
  return { points: simplify(collapseCollinear(full), grid), degraded: false };
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function isTurn(w: number, a: number, b: number, c: number): boolean {
  const horizontalAB = Math.floor(a / w) === Math.floor(b / w);
  const horizontalBC = Math.floor(b / w) === Math.floor(c / w);
  return horizontalAB !== horizontalBC;
}

function heuristic(
  grid: ObstacleGrid,
  a: { ix: number; iy: number },
  b: { ix: number; iy: number },
): number {
  const ax = grid.xs[a.ix] as number;
  const ay = grid.ys[a.iy] as number;
  const bx = grid.xs[b.ix] as number;
  const by = grid.ys[b.iy] as number;
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function nearestLattice(grid: ObstacleGrid, p: Point): { ix: number; iy: number } {
  return { ix: nearestIndex(grid.xs, p.x), iy: nearestIndex(grid.ys, p.y) };
}

function nearestIndex(values: readonly number[], v: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const d = Math.abs((values[i] as number) - v);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** The 3-segment fallback used when there are no obstacles, or when the budget runs out. */
export function zRoute(p0: Point, p1: Point): Point[] {
  const dx = Math.abs(p1.x - p0.x);
  const dy = Math.abs(p1.y - p0.y);
  if (dx < 1e-6 || dy < 1e-6) return [p0, p1];
  if (dx >= dy) {
    const mx = (p0.x + p1.x) / 2;
    return [p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1];
  }
  const my = (p0.y + p1.y) / 2;
  return [p0, { x: p0.x, y: my }, { x: p1.x, y: my }, p1];
}

/** Post-process 1: drop points that lie on the straight run between their neighbours. */
export function collapseCollinear(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) {
      continue;
    }
    out.push(p);
    const n = out.length;
    if (n >= 3) {
      const a = out[n - 3] as Point;
      const b = out[n - 2] as Point;
      const c = out[n - 1] as Point;
      const sameRow = Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6;
      const sameCol = Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6;
      if (sameRow || sameCol) out.splice(n - 2, 1);
    }
  }
  return out;
}

/**
 * Post-process 2: straighten staircases. Four consecutive points that step twice in the same
 * direction can be replaced by a single corner — either turning early or turning late — whenever
 * the replacement stays clear of the obstacles. Two passes, as the spec prescribes: one pass
 * leaves the second half of a long staircase behind.
 */
export function simplify(points: readonly Point[], grid?: ObstacleGrid): Point[] {
  const clear = (a: Point, b: Point): boolean => grid === undefined || !segmentBlocked(grid, a, b);
  let current = [...points];
  for (let pass = 0; pass < 2; pass += 1) {
    const out: Point[] = [];
    let i = 0;
    while (i < current.length) {
      const a = current[i] as Point;
      const b = current[i + 1];
      const c = current[i + 2];
      const d = current[i + 3];
      let corner: Point | null = null;
      if (b !== undefined && c !== undefined && d !== undefined) {
        for (const candidate of [
          { x: a.x, y: d.y },
          { x: d.x, y: a.y },
        ]) {
          if (same(candidate, a) || same(candidate, d)) continue;
          if (clear(a, candidate) && clear(candidate, d)) {
            corner = candidate;
            break;
          }
        }
      }
      if (corner !== null) {
        out.push(a, corner);
        i += 3;
      } else {
        out.push(a);
        i += 1;
      }
    }
    current = collapseCollinear(out);
  }
  return current;
}

function same(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

/**
 * Post-process 3: snap the *interior* segments to shared lanes so parallel edges line up. Terminal
 * segments keep their exact coordinates, otherwise a snapped lane would pull the path off its port.
 */
export function snapToLanes(points: readonly Point[], pitch = LANE_PITCH): Point[] {
  if (points.length <= 3) return points.map((p) => ({ ...p }));
  const out: Point[] = points.map((p) => ({ ...p }));
  for (let i = 1; i < out.length - 2; i += 1) {
    const a = out[i] as Point;
    const b = out[i + 1] as Point;
    if (Math.abs(a.x - b.x) < 1e-6) {
      const x = Math.round(a.x / pitch) * pitch;
      out[i] = { x, y: a.y };
      out[i + 1] = { x, y: b.y };
    } else if (Math.abs(a.y - b.y) < 1e-6) {
      const y = Math.round(a.y / pitch) * pitch;
      out[i] = { x: a.x, y };
      out[i + 1] = { x: b.x, y };
    }
  }
  return out;
}

/** Post-process 4: replace each corner with a quadratic of radius `cornerRadius`. */
export function roundCorners(points: readonly Point[], radius: number): PathCommand[] {
  const first = points[0] as Point;
  const cmds: PathCommand[] = [{ t: 'M', x: first.x, y: first.y }];
  if (points.length < 3 || radius <= 0) {
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i] as Point;
      cmds.push({ t: 'L', x: p.x, y: p.y });
    }
    return cmds;
  }

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1] as Point;
    const corner = points[i] as Point;
    const next = points[i + 1] as Point;
    const rIn = Math.min(radius, dist(prev, corner) / 2);
    const rOut = Math.min(radius, dist(corner, next) / 2);
    const enter = towards(corner, prev, rIn);
    const exit = towards(corner, next, rOut);
    cmds.push({ t: 'L', x: enter.x, y: enter.y });
    cmds.push({ t: 'Q', x1: corner.x, y1: corner.y, x: exit.x, y: exit.y });
  }
  const last = points[points.length - 1] as Point;
  cmds.push({ t: 'L', x: last.x, y: last.y });
  return cmds;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function towards(from: Point, to: Point, by: number): Point {
  const d = dist(from, to);
  if (d < 1e-6) return { ...from };
  return { x: from.x + ((to.x - from.x) / d) * by, y: from.y + ((to.y - from.y) / d) * by };
}

/** True when no obstacle sits between the endpoints — the common case, checked before A\*. */
export function corridorIsClear(grid: ObstacleGrid, p0: Point, p1: Point): boolean {
  const z = zRoute(p0, p1);
  for (let i = 1; i < z.length; i += 1) {
    if (segmentBlocked(grid, z[i - 1] as Point, z[i] as Point)) return false;
  }
  return true;
}

/** Minimal binary heap over integer ids; `pop` returns the id with the smallest priority. */
class BinaryHeap {
  private readonly ids: number[] = [];
  private readonly costs: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, cost: number): void {
    this.ids.push(id);
    this.costs.push(cost);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.costs[parent] as number) <= (this.costs[i] as number)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.ids[0] as number;
    const lastId = this.ids.pop() as number;
    const lastCost = this.costs.pop() as number;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.costs[0] = lastCost;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.ids.length && (this.costs[l] as number) < (this.costs[smallest] as number)) {
          smallest = l;
        }
        if (r < this.ids.length && (this.costs[r] as number) < (this.costs[smallest] as number)) {
          smallest = r;
        }
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a] as number;
    const cost = this.costs[a] as number;
    this.ids[a] = this.ids[b] as number;
    this.costs[a] = this.costs[b] as number;
    this.ids[b] = id;
    this.costs[b] = cost;
  }
}

/** Exposed for tests: containment check used to block lattice points. */
export function latticePointBlocked(grid: ObstacleGrid, ix: number, iy: number): boolean {
  return grid.blocked[iy * grid.xs.length + ix] === 1;
}
