import { describe, expect, it } from 'vitest';

import {
  LANE_PITCH,
  TURN_PENALTY,
  buildObstacleGrid,
  cheapCandidates,
  firstClearRoute,
  inflateBoxes,
  segmentBlockedBoxes,
  collapseCollinear,
  corridorIsClear,
  latticePointBlocked,
  roundCorners,
  routeOrthogonal,
  routingRegion,
  segmentBlocked,
  simplify,
  snapToLanes,
  zRoute,
  type NodeBox,
  type Point,
} from '../src/edges/index.ts';

const wall: NodeBox = { id: 'wall', x: 200, y: -200, w: 60, h: 400, radius: 0 };

const gridFor = (boxes: readonly NodeBox[], from: Point, to: Point) =>
  buildObstacleGrid(routingRegion(from, to), boxes, from, to);

describe('routingRegion', () => {
  it('is the endpoint box inflated by the margin', () => {
    const region = routingRegion({ x: 0, y: 0 }, { x: 100, y: 50 }, 10);
    expect(region).toEqual({ minX: -10, minY: -10, maxX: 110, maxY: 60 });
  });
});

describe('buildObstacleGrid', () => {
  it('lays a Hanan lattice over the obstacle borders and the endpoints', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 500, y: 0 };
    const grid = gridFor([wall], from, to);
    expect(grid.xs).toContain(0);
    expect(grid.xs).toContain(500);
    expect(grid.xs.length).toBeGreaterThanOrEqual(6);
    expect([...grid.xs]).toEqual([...grid.xs].sort((a, b) => a - b));
  });

  it('blocks the lattice points that fall strictly inside an inflated obstacle', () => {
    // A lone box only contributes its own borders, and a border point is routable; overlapping
    // boxes are what actually produce blocked lattice points.
    const bar: NodeBox = { id: 'bar', x: 200, y: -50, w: 400, h: 100, radius: 0 };
    const grid = gridFor([wall, bar], { x: 0, y: 0 }, { x: 500, y: 0 });
    expect([...grid.blocked].some((v) => v === 1)).toBe(true);
    expect(latticePointBlocked(grid, 0, 0)).toBe(false);
  });

  it('reports blocked segments only on a real interior overlap', () => {
    const grid = gridFor([wall], { x: 0, y: 0 }, { x: 500, y: 0 });
    expect(segmentBlocked(grid, { x: 0, y: 0 }, { x: 500, y: 0 })).toBe(true);
    expect(segmentBlocked(grid, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(false);
    expect(segmentBlocked(grid, { x: 0, y: 900 }, { x: 500, y: 900 })).toBe(false);
  });

  it('knows when the direct corridor is clear', () => {
    const clear = gridFor([], { x: 0, y: 0 }, { x: 500, y: 40 });
    expect(corridorIsClear(clear, { x: 0, y: 0 }, { x: 500, y: 40 })).toBe(true);
    const blocked = gridFor([wall], { x: 0, y: 0 }, { x: 500, y: 40 });
    expect(corridorIsClear(blocked, { x: 0, y: 0 }, { x: 500, y: 40 })).toBe(false);
  });
});

describe('zRoute', () => {
  it('splits horizontally when the run is wider than tall', () => {
    expect(zRoute({ x: 0, y: 0 }, { x: 100, y: 40 })).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 40 },
    ]);
  });

  it('splits vertically when the run is taller than wide', () => {
    expect(zRoute({ x: 0, y: 0 }, { x: 40, y: 100 })).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 40, y: 50 },
      { x: 40, y: 100 },
    ]);
  });

  it('stays a single segment when the endpoints already share an axis', () => {
    expect(zRoute({ x: 0, y: 0 }, { x: 100, y: 0 })).toHaveLength(2);
  });
});

describe('routeOrthogonal', () => {
  it('walks around an obstacle with axis-aligned segments only', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 500, y: 0 };
    const grid = gridFor([wall], from, to);
    const result = routeOrthogonal(grid, from, to);
    expect(result.degraded).toBe(false);
    for (let i = 1; i < result.points.length; i += 1) {
      const a = result.points[i - 1] as Point;
      const b = result.points[i] as Point;
      expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6).toBe(true);
    }
    // The path must leave the wall's vertical span somewhere.
    const escapes = result.points.some((p) => p.y < -200 || p.y > 200);
    expect(escapes).toBe(true);
  });

  it('falls back to the Z route when the time budget is already spent', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 500, y: 0 };
    const grid = gridFor([wall], from, to);
    let calls = 0;
    // A clock that jumps a minute on the second read exhausts the budget immediately.
    const result = routeOrthogonal(grid, from, to, () => (calls++ === 0 ? 0 : 60_000));
    expect(result.degraded).toBe(true);
    expect(result.points).toEqual(zRoute(from, to));
  });

  it('turns cost more than distance, so the result is not a staircase', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 400, y: 200 };
    const grid = gridFor([], from, to);
    const result = routeOrthogonal(grid, from, to);
    expect(result.points.length).toBeLessThanOrEqual(4);
    expect(TURN_PENALTY).toBeGreaterThan(0);
  });
});

describe('post-processing', () => {
  it('collapses collinear runs and duplicate points', () => {
    expect(
      collapseCollinear([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ]);
  });

  it('straightens a staircase into fewer corners', () => {
    const simplified = simplify([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
    ]);
    expect(simplified.length).toBeLessThan(5);
    for (let i = 1; i < simplified.length; i += 1) {
      const a = simplified[i - 1] as Point;
      const b = simplified[i] as Point;
      expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6).toBe(true);
    }
  });

  it('keeps a shortcut that a grid says is blocked', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 500, y: 0 };
    const grid = gridFor([wall], from, to);
    const staircase = [
      { x: 0, y: 0 },
      { x: 0, y: -400 },
      { x: 500, y: -400 },
      { x: 500, y: 0 },
    ];
    expect(simplify(staircase, grid)).toEqual(staircase);
  });

  it('snaps interior segments to the lane pitch without moving the endpoints', () => {
    const snapped = snapToLanes([
      { x: 0, y: 0 },
      { x: 13, y: 0 },
      { x: 13, y: 41 },
      { x: 100, y: 41 },
      { x: 100, y: 90 },
    ]);
    expect(snapped[0]).toEqual({ x: 0, y: 0 });
    expect(snapped[snapped.length - 1]).toEqual({ x: 100, y: 90 });
    expect((snapped[1] as Point).x % LANE_PITCH).toBe(0);
    expect((snapped[1] as Point).x).toBe((snapped[2] as Point).x);
  });

  it('leaves a short path alone', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(snapToLanes(path)).toEqual(path);
  });

  it('rounds corners with quadratics and keeps the endpoints', () => {
    const cmds = roundCorners(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      8,
    );
    expect(cmds[0]).toEqual({ t: 'M', x: 0, y: 0 });
    expect(cmds.some((c) => c.t === 'Q')).toBe(true);
    expect(cmds[cmds.length - 1]).toEqual({ t: 'L', x: 100, y: 100 });
  });

  it('falls back to plain lines when there is no corner or no radius', () => {
    const cmds = roundCorners(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      8,
    );
    expect(cmds).toEqual([
      { t: 'M', x: 0, y: 0 },
      { t: 'L', x: 10, y: 0 },
    ]);
  });
});

describe('lattice marking on a dense board', () => {
  it('blocks exactly the points strictly inside the inflated obstacles', () => {
    const boxes: NodeBox[] = [
      { id: 'a', x: 100, y: 100, w: 80, h: 60, radius: 0 },
      { id: 'b', x: 300, y: 240, w: 40, h: 40, radius: 0 },
    ];
    const grid = gridFor(boxes, { x: 0, y: 0 }, { x: 500, y: 400 });
    for (let iy = 0; iy < grid.ys.length; iy += 1) {
      for (let ix = 0; ix < grid.xs.length; ix += 1) {
        const p = { x: grid.xs[ix] as number, y: grid.ys[iy] as number };
        const naive = grid.boxes.some(
          (b) => p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY,
        );
        expect(latticePointBlocked(grid, ix, iy)).toBe(naive);
      }
    }
  });

  it('builds a grid for a crowded region without quadratic-per-point work', () => {
    const boxes: NodeBox[] = [];
    for (let i = 0; i < 120; i += 1) {
      boxes.push({
        id: `n${i}`,
        x: (i % 12) * 90,
        y: Math.floor(i / 12) * 70,
        w: 60,
        h: 40,
        radius: 0,
      });
    }
    const grid = gridFor(boxes, { x: -50, y: -50 }, { x: 1100, y: 750 });
    expect(grid.boxes).toHaveLength(120);
    expect(grid.blocked).toHaveLength(grid.xs.length * grid.ys.length);
    // Lattice corners sit *on* the inflated borders, so a regular grid of cards leaves them all
    // routable — the marking pass must not invent blocked points.
    expect([...grid.blocked].every((v) => v === 0)).toBe(true);
  });
});

describe('cheap rectilinear candidates', () => {
  it('offers a Z and both L shapes, leading with the dominant axis', () => {
    const wide = cheapCandidates({ x: 0, y: 0 }, { x: 400, y: 60 });
    expect(wide).toHaveLength(4);
    expect(wide[0]?.[1]).toEqual({ x: 200, y: 0 });
    const tall = cheapCandidates({ x: 0, y: 0 }, { x: 60, y: 400 });
    expect(tall[0]?.[1]).toEqual({ x: 0, y: 200 });
  });

  it('collapses to a straight run when the endpoints share an axis', () => {
    expect(cheapCandidates({ x: 0, y: 0 }, { x: 300, y: 0 })).toEqual([
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
      ],
    ]);
  });

  it('picks the first shape that clears the cards and gives up when none does', () => {
    const open = inflateBoxes([{ id: 'far', x: 0, y: 600, w: 40, h: 40, radius: 0 }]);
    expect(firstClearRoute(open, { x: 0, y: 0 }, { x: 400, y: 200 })).not.toBeNull();

    const from: Point = { x: 0, y: 0 };
    const to: Point = { x: 400, y: 200 };
    const blocking = inflateBoxes([
      { id: 'v', x: 180, y: -400, w: 40, h: 900, radius: 0 },
      { id: 'h', x: -400, y: 90, w: 1200, h: 30, radius: 0 },
    ]);
    expect(firstClearRoute(blocking, from, to)).toBeNull();
    expect(segmentBlockedBoxes(blocking, from, { x: 400, y: 0 })).toBe(true);
  });

  it('accepts a grid as well as bare boxes', () => {
    const grid = gridFor([], { x: 0, y: 0 }, { x: 200, y: 120 });
    expect(firstClearRoute(grid, { x: 0, y: 0 }, { x: 200, y: 120 })).not.toBeNull();
  });
});
