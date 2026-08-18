import { describe, expect, it } from 'vitest';

import {
  HIT_TOLERANCE,
  HIT_TOLERANCE_WIDE,
  bboxHit,
  distanceToEdge,
  hitTolerance,
  isEdgeHit,
  nearestPointOnEdge,
  pickEdge,
  route,
  withRouteDefaults,
  type EdgeGeometry,
  type NodeBox,
} from '../src/edges/index.ts';

const source: NodeBox = { id: 'a', x: 0, y: 0, w: 100, h: 60, radius: 0 };
const target: NodeBox = { id: 'b', x: 400, y: 0, w: 100, h: 60, radius: 0 };
const geometry: EdgeGeometry = route(withRouteDefaults({ source, target, mode: 'straight' }));

describe('hitTolerance', () => {
  it('grows as the board zooms out so an edge stays clickable', () => {
    expect(hitTolerance(1)).toBe(HIT_TOLERANCE);
    expect(hitTolerance(0.5)).toBe(HIT_TOLERANCE * 2);
    expect(hitTolerance(1, true)).toBe(HIT_TOLERANCE_WIDE);
  });
});

describe('bboxHit', () => {
  it('is a cheap rejection test with the tolerance folded in', () => {
    expect(bboxHit(geometry.bbox, { x: 200, y: 30 }, 4)).toBe(true);
    expect(bboxHit(geometry.bbox, { x: 200, y: 900 }, 4)).toBe(false);
  });
});

describe('distanceToEdge', () => {
  it('measures to the polyline inside the bbox and rejects far points outright', () => {
    expect(distanceToEdge(geometry, { x: 200, y: 33 }, 6)).toBeCloseTo(3, 3);
    expect(distanceToEdge(geometry, { x: 200, y: 900 }, 6)).toBe(Infinity);
    expect(isEdgeHit(geometry, { x: 200, y: 33 }, 6)).toBe(true);
    expect(isEdgeHit(geometry, { x: 200, y: 50 }, 6)).toBe(false);
  });
});

describe('nearestPointOnEdge', () => {
  it('returns the projection and its arc-length parameter', () => {
    const near = nearestPointOnEdge(geometry, { x: 250, y: 60 });
    expect(near.point.y).toBeCloseTo(30, 3);
    expect(near.t).toBeGreaterThan(0.4);
    expect(near.t).toBeLessThan(0.6);
    expect(near.distance).toBeCloseTo(30, 3);
  });

  it('handles a degenerate geometry', () => {
    const degenerate: EdgeGeometry = { ...geometry, flat: Float32Array.from([5, 5]) };
    expect(nearestPointOnEdge(degenerate, { x: 5, y: 10 })).toMatchObject({ t: 0, distance: 5 });
  });
});

describe('pickEdge', () => {
  const other = route(
    withRouteDefaults({
      source: { ...source, id: 'a2', y: 100 },
      target: { ...target, id: 'b2', y: 100 },
      mode: 'straight',
    }),
  );

  it('returns the closest candidate within the tolerance', () => {
    const picked = pickEdge(
      [
        { id: 'e1', geometry },
        { id: 'e2', geometry: other },
      ],
      { x: 250, y: 32 },
      6,
    );
    expect(picked?.id).toBe('e1');
  });

  it('lets priority beat proximity, and returns null when nothing is close', () => {
    const picked = pickEdge(
      [
        { id: 'e1', geometry },
        { id: 'e2', geometry: other, priority: 5 },
      ],
      { x: 250, y: 90 },
      50,
    );
    expect(picked?.id).toBe('e2');
    expect(pickEdge([{ id: 'e1', geometry }], { x: 250, y: 900 }, 6)).toBeNull();
  });
});
