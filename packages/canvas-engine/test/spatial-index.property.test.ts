/**
 * 18_TESTING.md §4.4: for random insert/move/remove scripts, `queryRect` must return exactly the
 * set a brute-force scan returns. `fast-check` is not a dependency of this package, so the property
 * runs over 200 seeded scenes with the inline PRNG below (same numRuns as §4).
 */

import { describe, expect, it } from 'vitest';
import { createGridIndex, rectsIntersect, rectContainsPoint } from '../src/scene/index-grid';
import { INDEX_CELL_SIZE, MIN_NODE_SIZE } from '../src/constants';
import type { Rect } from '../src/types';

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand: () => number, lo: number, hi: number): number => lo + rand() * (hi - lo);

function bruteRect(rects: Map<string, Rect>, q: Rect): string[] {
  return [...rects].filter(([, r]) => rectsIntersect(r, q)).map(([id]) => id);
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

describe('grid index vs brute force', () => {
  it('agrees with a linear scan on 200 random scenes after insert/move/remove scripts', () => {
    for (let run = 0; run < 200; run += 1) {
      const rand = prng(run + 1);
      const index = createGridIndex();
      const oracle = new Map<string, Rect>();
      const count = Math.floor(between(rand, 1, 60));
      const spread = between(rand, 100, 6000);

      for (let i = 0; i < count; i += 1) {
        const r: Rect = {
          x: between(rand, -spread, spread),
          y: between(rand, -spread, spread),
          // Deliberately spans the oversize threshold (4 × cell) so the overflow list is exercised.
          w: between(rand, MIN_NODE_SIZE, INDEX_CELL_SIZE * 5),
          h: between(rand, MIN_NODE_SIZE, INDEX_CELL_SIZE * 5),
        };
        index.insert(`n${i}`, r);
        oracle.set(`n${i}`, r);
      }

      for (let i = 0; i < count; i += 1) {
        const id = `n${Math.floor(rand() * count)}`;
        const prev = oracle.get(id);
        if (prev === undefined) continue;
        if (rand() < 0.25) {
          index.remove(id);
          oracle.delete(id);
          continue;
        }
        const moved: Rect = {
          ...prev,
          x: prev.x + between(rand, -spread, spread),
          y: prev.y + between(rand, -spread, spread),
        };
        index.update(id, moved);
        oracle.set(id, moved);
      }

      expect(index.size).toBe(oracle.size);

      for (let q = 0; q < 4; q += 1) {
        const query: Rect = {
          x: between(rand, -spread, spread),
          y: between(rand, -spread, spread),
          w: between(rand, 1, spread),
          h: between(rand, 1, spread),
        };
        expect(sorted(index.queryRect(query))).toEqual(sorted(bruteRect(oracle, query)));
      }

      const point = { x: between(rand, -spread, spread), y: between(rand, -spread, spread) };
      const bruteHits = [...oracle]
        .filter(([, r]) => rectContainsPoint(r, point))
        .map(([id]) => id);
      expect(sorted(index.queryPoint(point))).toEqual(sorted(bruteHits));
    }
  });

  it('falls back to a linear scan for queries covering more cells than the map lookup is worth', () => {
    const index = createGridIndex();
    index.insert('a', { x: 0, y: 0, w: 100, h: 100 });
    index.insert('b', { x: 4e6, y: 4e6, w: 100, h: 100 });
    // 1e7-wide rect ⇒ ~19,500 cells per axis, far past MAX_CELLS_PER_QUERY.
    expect(sorted(index.queryRect({ x: -5e6, y: -5e6, w: 1e7, h: 1e7 }))).toEqual(['a', 'b']);
  });

  it('reuses the "out" array without allocating and clears it first', () => {
    const index = createGridIndex();
    index.insert('a', { x: 0, y: 0, w: 100, h: 100 });
    const out: string[] = ['stale'];
    const returned = index.queryRect({ x: 0, y: 0, w: 10, h: 10 }, out);
    expect(returned).toBe(out);
    expect(out).toEqual(['a']);
    index.queryRect({ x: 1e5, y: 1e5, w: 10, h: 10 }, out);
    expect(out).toEqual([]);
    index.queryPoint({ x: 5, y: 5 }, out);
    expect(out).toEqual(['a']);
  });
});

describe('grid index degenerate cases', () => {
  it('handles 5,000 items at identical coordinates', () => {
    const index = createGridIndex();
    for (let i = 0; i < 5000; i += 1) index.insert(`n${i}`, { x: 1000, y: 1000, w: 200, h: 120 });
    expect(index.size).toBe(5000);
    expect(index.stats().maxBucket).toBe(5000);
    expect(index.queryRect({ x: 1050, y: 1050, w: 1, h: 1 })).toHaveLength(5000);
    expect(index.queryPoint({ x: 1050, y: 1050 })).toHaveLength(5000);
    expect(index.queryRect({ x: -5000, y: -5000, w: 10, h: 10 })).toHaveLength(0);
  });

  it('clamps zero and negative sizes to MIN_NODE_SIZE and reports exactly once', () => {
    const reports: string[] = [];
    const index = createGridIndex({ onDegenerateRect: (id) => reports.push(String(id)) });
    index.insert('zero', { x: 0, y: 0, w: 0, h: 0 });
    index.insert('negative', { x: 500, y: 0, w: -40, h: -40 });
    index.update('zero', { x: 0, y: 0, w: Number.NaN, h: 10 });
    expect(reports).toEqual(['zero']);
    expect(index.rectOf('zero')).toEqual({ x: 0, y: 0, w: MIN_NODE_SIZE, h: MIN_NODE_SIZE });
    expect(index.rectOf('negative')).toEqual({
      x: 500,
      y: 0,
      w: MIN_NODE_SIZE,
      h: MIN_NODE_SIZE,
    });
    expect(index.queryPoint({ x: 1, y: 1 })).toEqual(['zero']);
  });

  it('clamps extreme and non-finite coordinates into the world range', () => {
    const index = createGridIndex();
    index.insert('far', { x: 1e9, y: -1e9, w: 100, h: 100 });
    index.insert('nan', { x: Number.NaN, y: Number.POSITIVE_INFINITY, w: 100, h: 100 });
    expect(index.rectOf('far')).toEqual({ x: 1e7, y: -1e7, w: 100, h: 100 });
    expect(index.rectOf('nan')).toEqual({ x: 0, y: 1e7, w: 100, h: 100 });
    expect(index.queryRect({ x: 1e7 - 1, y: -1e7, w: 10, h: 10 })).toEqual(['far']);
  });

  it('moves oversized items in and out of the overflow list', () => {
    const index = createGridIndex();
    const huge = { x: 0, y: 0, w: INDEX_CELL_SIZE * 6, h: 100 };
    index.insert('big', huge);
    expect(index.stats().oversized).toBe(1);
    expect(index.queryRect({ x: INDEX_CELL_SIZE * 5, y: 10, w: 5, h: 5 })).toEqual(['big']);
    index.update('big', { x: 0, y: 0, w: 100, h: 100 });
    expect(index.stats().oversized).toBe(0);
    expect(index.queryRect({ x: INDEX_CELL_SIZE * 5, y: 10, w: 5, h: 5 })).toEqual([]);
    index.update('big', huge);
    expect(index.stats().oversized).toBe(1);
    index.remove('big');
    expect(index.size).toBe(0);
  });

  it('is empty and inert after clear(), and ignores removal of unknown ids', () => {
    const index = createGridIndex({ cellSize: 64 });
    index.insert('a', { x: 0, y: 0, w: 32, h: 32 });
    index.remove('missing');
    expect(index.stats()).toEqual({ cells: 1, oversized: 0, maxBucket: 1, avgBucket: 1 });
    index.clear();
    expect(index.size).toBe(0);
    expect(index.stats()).toEqual({ cells: 0, oversized: 0, maxBucket: 0, avgBucket: 0 });
    expect(index.queryRect({ x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    expect(index.rectOf('a')).toBeUndefined();
  });

  it('keeps the fast path when a move stays inside the same cell span', () => {
    const index = createGridIndex();
    index.insert('a', { x: 10, y: 10, w: 100, h: 100 });
    const before = index.stats().cells;
    index.update('a', { x: 12, y: 14, w: 100, h: 100 });
    expect(index.stats().cells).toBe(before);
    expect(index.rectOf('a')).toEqual({ x: 12, y: 14, w: 100, h: 100 });
    index.update('a', { x: INDEX_CELL_SIZE * 3, y: INDEX_CELL_SIZE * 3, w: 100, h: 100 });
    expect(index.queryRect({ x: 0, y: 0, w: 50, h: 50 })).toEqual([]);
  });

  it('updates an id that was never inserted by inserting it', () => {
    const index = createGridIndex();
    index.update('ghost', { x: 0, y: 0, w: 50, h: 50 });
    expect(index.queryRect({ x: 10, y: 10, w: 1, h: 1 })).toEqual(['ghost']);
  });
});
