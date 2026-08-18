import { describe, expect, it } from 'vitest';

import {
  ENDPOINT_GAP,
  clipToBoxes,
  insideRoundedBox,
  trimPolyline,
  type NodeBox,
} from '../src/edges/index.ts';

const source: NodeBox = { id: 'a', x: 0, y: 0, w: 100, h: 60, radius: 8 };
const target: NodeBox = { id: 'b', x: 300, y: 0, w: 100, h: 60, radius: 8 };

describe('insideRoundedBox', () => {
  it('accepts interior points and rejects far ones', () => {
    expect(insideRoundedBox({ x: 50, y: 30 }, source)).toBe(true);
    expect(insideRoundedBox({ x: 500, y: 30 }, source)).toBe(false);
  });

  it('cuts the corners of a rounded card', () => {
    const sharp: NodeBox = { ...source, radius: 0 };
    expect(insideRoundedBox({ x: 0, y: 0 }, sharp)).toBe(true);
    expect(insideRoundedBox({ x: 0.2, y: 0.2 }, { ...source, radius: 20 })).toBe(false);
    expect(insideRoundedBox({ x: 20, y: 20 }, { ...source, radius: 20 })).toBe(true);
  });

  it('respects the inflation gap', () => {
    expect(insideRoundedBox({ x: -1, y: 30 }, source)).toBe(false);
    expect(insideRoundedBox({ x: -1, y: 30 }, source, ENDPOINT_GAP)).toBe(true);
  });
});

describe('clipToBoxes', () => {
  it('trims both ends to the card borders and reports tangent angles', () => {
    const flat = [50, 30, 200, 30, 350, 30];
    const clipped = clipToBoxes(flat, source, target);
    expect(clipped.start.x).toBeGreaterThan(100);
    expect(clipped.start.x).toBeLessThan(110);
    expect(clipped.end.x).toBeGreaterThan(290);
    expect(clipped.end.x).toBeLessThan(300);
    expect(clipped.start.angle).toBeCloseTo(0, 3);
    expect(clipped.end.angle).toBeCloseTo(0, 3);
  });

  it('keeps the original endpoints when every sample is inside a card', () => {
    const overlapping: NodeBox = { ...target, x: 0 };
    const clipped = clipToBoxes([10, 10, 40, 40], source, overlapping);
    expect(clipped.flat.length).toBeGreaterThanOrEqual(4);
    expect(clipped.start).toMatchObject({ x: 10, y: 10 });
  });

  it('handles a single-point path without throwing', () => {
    const clipped = clipToBoxes([7, 8], source, target);
    expect(clipped.flat).toEqual([7, 8, 7, 8]);
    expect(clipped.start.angle).toBe(0);
  });
});

describe('trimPolyline', () => {
  it('shortens both ends by an arc length', () => {
    const trimmed = trimPolyline([0, 0, 100, 0], 10, 20);
    expect(trimmed[0]).toBeCloseTo(10, 6);
    expect(trimmed[trimmed.length - 2]).toBeCloseTo(80, 6);
  });

  it('is a no-op for zero trims', () => {
    expect(trimPolyline([0, 0, 10, 0], 0, 0)).toEqual([0, 0, 10, 0]);
  });

  it('collapses to the midpoint instead of inverting when over-trimmed', () => {
    const trimmed = trimPolyline([0, 0, 10, 0], 100, 0);
    expect(trimmed.length).toBeGreaterThanOrEqual(4);
    expect(trimmed[0]).toBeCloseTo(5, 6);
  });

  it('returns short inputs untouched', () => {
    expect(trimPolyline([1, 2], 5, 5)).toEqual([1, 2]);
  });
});
