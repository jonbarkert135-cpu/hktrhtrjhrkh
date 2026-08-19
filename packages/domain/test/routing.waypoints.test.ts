/**
 * Waypoint list maths and waypointed routing (07_EDGE_SYSTEM.md §8.3, P5 part 4 §1).
 */

import { describe, expect, it } from 'vitest';

import {
  bundledSeparation,
  insertWaypoint,
  moveWaypoint,
  nearestWaypoint,
  removeWaypoint,
  route,
  waypointInsertIndex,
  waypointsInsideBoxes,
  withRouteDefaults,
  type NodeBox,
} from '../src/edges/routing/index.ts';

const box = (id: string, x: number, y: number): NodeBox => ({ id, x, y, w: 100, h: 60, radius: 4 });

describe('waypoint list maths', () => {
  it('inserts on the nearest segment, keeping the run in order', () => {
    const existing = [{ x: 400, y: 0 }];
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 800, y: 0 };
    expect(waypointInsertIndex(existing, p0, p1, { x: 100, y: 20 })).toBe(0);
    expect(waypointInsertIndex(existing, p0, p1, { x: 700, y: 20 })).toBe(1);
    expect(insertWaypoint(existing, p0, p1, { x: 700, y: 20 })).toEqual([
      { x: 400, y: 0 },
      { x: 700, y: 20 },
    ]);
  });

  it('moves and removes by index, and ignores stale indices', () => {
    const list = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    expect(moveWaypoint(list, 1, { x: 9, y: 9 })).toEqual([
      { x: 1, y: 1 },
      { x: 9, y: 9 },
    ]);
    expect(moveWaypoint(list, 7, { x: 9, y: 9 })).toEqual(list);
    expect(removeWaypoint(list, 0)).toEqual([{ x: 2, y: 2 }]);
    expect(removeWaypoint(list, -1)).toEqual(list);
  });

  it('picks the nearest waypoint inside the tolerance only', () => {
    const list = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ];
    expect(nearestWaypoint(list, { x: 47, y: 2 }, 8)).toBe(1);
    expect(nearestWaypoint(list, { x: 25, y: 0 }, 8)).toBeNull();
  });

  it('flags waypoints that ended up inside a card', () => {
    const boxes = [box('a', 0, 0)];
    expect(
      waypointsInsideBoxes(
        [
          { x: 50, y: 30 },
          { x: 500, y: 500 },
        ],
        boxes,
      ),
    ).toEqual([0]);
  });
});

describe('routing through waypoints', () => {
  const source = box('a', 0, 0);
  const target = box('b', 600, 0);
  const waypoints = [{ x: 300, y: 240 }];

  it('orthogonal paths visit the waypoints in order', () => {
    const geometry = route(withRouteDefaults({ source, target, mode: 'orthogonal', waypoints }));
    // The flattened polyline must come within a corner radius of the waypoint.
    let nearest = Infinity;
    for (let i = 0; i < geometry.flat.length; i += 2) {
      const dx = (geometry.flat[i] as number) - 300;
      const dy = (geometry.flat[i + 1] as number) - 240;
      nearest = Math.min(nearest, Math.hypot(dx, dy));
    }
    expect(nearest).toBeLessThan(12);
    expect(geometry.mode).toBe('orthogonal');
  });

  it('a curved path bends towards the waypoint', () => {
    const withWaypoint = route(withRouteDefaults({ source, target, mode: 'curved', waypoints }));
    const without = route(withRouteDefaults({ source, target, mode: 'curved' }));
    expect(withWaypoint.bbox.maxY).toBeGreaterThan(without.bbox.maxY + 100);
  });
});

describe('bundling density', () => {
  it('keeps the fan below the threshold and collapses a dense run', () => {
    expect(bundledSeparation(3, 1)).toBe(18);
    expect(bundledSeparation(9, 0)).toBe(18);
    expect(bundledSeparation(9, 1)).toBe(0);
    expect(bundledSeparation(9, 0.5)).toBe(9);
  });
});
