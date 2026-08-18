import { describe, expect, it } from 'vitest';

import {
  bboxContains,
  bboxIntersects,
  bboxOfPoints,
  boxToBBox,
  centerOf,
  cubicAt,
  cubicSegments,
  distance,
  distanceToPolyline,
  dot,
  flattenCommands,
  inflate,
  lerp,
  normalize,
  perpendicular,
  pointAtFraction,
  pointAtIndex,
  pointCount,
  polylineBBox,
  polylineLength,
  projectOnSegment,
  quadraticAt,
  scale,
  sub,
  add,
  length,
  pushPoint,
  FLATTEN_DRAFT_SEGMENTS,
  type PathCommand,
} from '../src/edges/index.ts';

describe('vector helpers', () => {
  it('adds, subtracts, scales and measures', () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(sub({ x: 3, y: 4 }, { x: 1, y: 2 })).toEqual({ x: 2, y: 2 });
    expect(scale({ x: 2, y: -3 }, 2)).toEqual({ x: 4, y: -6 });
    expect(length({ x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 0, y: 0 }, { x: 0, y: 7 })).toBe(7);
    expect(dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0);
  });

  it('normalizes the zero vector to a unit x instead of NaN', () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(normalize({ x: 0, y: -4 })).toEqual({ x: 0, y: -1 });
  });

  it('takes the left-hand perpendicular and interpolates', () => {
    expect(perpendicular({ x: 1, y: 0 }).y).toBe(1);
    expect(perpendicular({ x: 1, y: 0 }).x).toBeCloseTo(0, 12);
    expect(lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.25)).toEqual({ x: 2.5, y: 5 });
    expect(centerOf({ x: 0, y: 0, w: 10, h: 4 })).toEqual({ x: 5, y: 2 });
  });
});

describe('bezier sampling', () => {
  it('hits both endpoints exactly', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 100, y: 0 };
    expect(cubicAt(p0, { x: 30, y: 50 }, { x: 70, y: 50 }, p1, 0)).toEqual(p0);
    expect(cubicAt(p0, { x: 30, y: 50 }, { x: 70, y: 50 }, p1, 1)).toEqual(p1);
    expect(quadraticAt(p0, { x: 50, y: 60 }, p1, 0.5)).toEqual({ x: 50, y: 30 });
  });

  it('spends two segments on a flat curve and more on a bowed one', () => {
    const flat = cubicSegments({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, 64);
    const bowed = cubicSegments(
      { x: 0, y: 0 },
      { x: 0, y: 300 },
      { x: 300, y: 300 },
      { x: 300, y: 0 },
      64,
    );
    expect(flat).toBe(2);
    expect(bowed).toBeGreaterThan(flat);
    expect(bowed).toBeLessThanOrEqual(64);
  });

  it('honours the draft segment cap', () => {
    const cmds: PathCommand[] = [
      { t: 'M', x: 0, y: 0 },
      { t: 'C', x1: 0, y1: 400, x2: 400, y2: 400, x: 400, y: 0 },
    ];
    const draft = flattenCommands(cmds, FLATTEN_DRAFT_SEGMENTS);
    const full = flattenCommands(cmds);
    expect(pointCount(draft)).toBeLessThanOrEqual(FLATTEN_DRAFT_SEGMENTS + 1);
    expect(pointCount(full)).toBeGreaterThan(pointCount(draft));
  });

  it('flattens quadratics and never emits duplicate points', () => {
    const flat = flattenCommands([
      { t: 'M', x: 0, y: 0 },
      { t: 'Q', x1: 10, y1: 10, x: 20, y: 0 },
      { t: 'L', x: 20, y: 0 },
    ]);
    for (let i = 1; i < pointCount(flat); i += 1) {
      expect(distance(pointAtIndex(flat, i - 1), pointAtIndex(flat, i))).toBeGreaterThan(0);
    }
  });

  it('keeps two points for a degenerate path so hit-testing still works', () => {
    const flat = flattenCommands([{ t: 'M', x: 5, y: 5 }]);
    expect(pointCount(flat)).toBe(2);
  });

  it('pushPoint skips a repeated point', () => {
    const out: number[] = [];
    pushPoint(out, { x: 1, y: 1 });
    pushPoint(out, { x: 1, y: 1 });
    expect(out).toEqual([1, 1]);
  });
});

describe('polyline measurements', () => {
  const flat = [0, 0, 10, 0, 10, 10];

  it('measures length and bounding box', () => {
    expect(polylineLength(flat)).toBe(20);
    expect(polylineBBox(flat)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('walks arc length for pointAtFraction', () => {
    const mid = pointAtFraction(flat, 0.5);
    expect(mid.x).toBeCloseTo(10, 6);
    expect(mid.y).toBeCloseTo(0, 6);
    const end = pointAtFraction(flat, 1);
    expect(end).toMatchObject({ x: 10, y: 10 });
    const start = pointAtFraction(flat, -1);
    expect(start).toMatchObject({ x: 0, y: 0 });
  });

  it('returns the single point of a degenerate polyline', () => {
    expect(pointAtFraction([3, 4], 0.5)).toEqual({ x: 3, y: 4, angle: 0 });
  });

  it('projects onto a segment with clamping', () => {
    expect(projectOnSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({
      d2: 25,
      t: 0.5,
    });
    expect(projectOnSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }).t).toBe(0);
    expect(projectOnSegment({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 }).t).toBe(0);
  });

  it('measures the distance to a polyline', () => {
    expect(distanceToPolyline(flat, { x: 5, y: 3 })).toBe(3);
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Infinity);
    expect(distanceToPolyline([2, 2], { x: 2, y: 5 })).toBe(3);
  });
});

describe('bbox helpers', () => {
  it('converts, inflates and intersects', () => {
    const bbox = boxToBBox({ x: 0, y: 0, w: 10, h: 10 });
    expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(inflate(bbox, 5)).toEqual({ minX: -5, minY: -5, maxX: 15, maxY: 15 });
    expect(bboxIntersects(bbox, { minX: 9, minY: 9, maxX: 20, maxY: 20 })).toBe(true);
    expect(bboxIntersects(bbox, { minX: 11, minY: 0, maxX: 20, maxY: 20 })).toBe(false);
    expect(bboxContains(bbox, { x: 5, y: 5 })).toBe(true);
    expect(bboxContains(bbox, { x: 50, y: 5 })).toBe(false);
    expect(
      bboxOfPoints([
        { x: 1, y: 2 },
        { x: -3, y: 8 },
      ]),
    ).toEqual({
      minX: -3,
      minY: 2,
      maxX: 1,
      maxY: 8,
    });
  });
});
