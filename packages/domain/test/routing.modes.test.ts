import { describe, expect, it } from 'vitest';

import {
  BUNDLE_THRESHOLD,
  EXPANDED_BUNDLE_SEPARATION,
  MAX_CONTROL_REACH,
  MIN_CONTROL_REACH,
  SELF_LOOP_RADIUS,
  SELF_LOOP_RING_STEP,
  SEPARATION,
  bundleWidth,
  catmullRomToBezier,
  controlReach,
  isBundled,
  routeCurved,
  routeSelfLoop,
  routeStraight,
  selfLoopRadius,
  selfLoopSide,
  siblingOffset,
  type NodeBox,
} from '../src/edges/index.ts';

describe('siblingOffset', () => {
  it('is zero for a lone edge and symmetric for a group', () => {
    expect(siblingOffset(0, 1)).toBe(0);
    expect([0, 1, 2].map((i) => siblingOffset(i, 3))).toEqual([-SEPARATION, 0, SEPARATION]);
    expect([0, 1, 2, 3].map((i) => siblingOffset(i, 4))).toEqual([
      -1.5 * SEPARATION,
      -0.5 * SEPARATION,
      0.5 * SEPARATION,
      1.5 * SEPARATION,
    ]);
  });

  it('clamps an out-of-range index', () => {
    expect(siblingOffset(99, 3)).toBe(SEPARATION);
    expect(siblingOffset(-5, 3)).toBe(-SEPARATION);
  });

  it('bundles above the threshold', () => {
    expect(isBundled(BUNDLE_THRESHOLD)).toBe(false);
    expect(isBundled(BUNDLE_THRESHOLD + 1)).toBe(true);
    expect(bundleWidth(8)).toBeCloseTo(1.5 + 3, 6);
    expect(EXPANDED_BUNDLE_SEPARATION).toBeLessThan(SEPARATION);
  });
});

describe('routeStraight', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 100, y: 0 };

  it('emits a move and a line', () => {
    expect(routeStraight({ p0, p1, waypoints: [], siblingIndex: 0, siblingCount: 1 })).toEqual([
      { t: 'M', x: 0, y: 0 },
      { t: 'L', x: 100, y: 0 },
    ]);
  });

  it('threads the waypoints in order', () => {
    const cmds = routeStraight({
      p0,
      p1,
      waypoints: [{ x: 40, y: 40 }],
      siblingIndex: 0,
      siblingCount: 1,
    });
    expect(cmds).toHaveLength(3);
    expect(cmds[1]).toEqual({ t: 'L', x: 40, y: 40 });
  });

  it('shifts the whole segment perpendicular for a parallel sibling', () => {
    const cmds = routeStraight({ p0, p1, waypoints: [], siblingIndex: 2, siblingCount: 3 });
    expect(cmds[0]).toEqual({ t: 'M', x: 0, y: SEPARATION });
    expect(cmds[1]).toEqual({ t: 'L', x: 100, y: SEPARATION });
  });
});

describe('routeCurved', () => {
  const base = {
    p0: { x: 0, y: 0 },
    p1: { x: 400, y: 0 },
    n0: { x: 1, y: 0 },
    n1: { x: -1, y: 0 },
    waypoints: [],
    curvature: 0.35,
    siblingIndex: 0,
    siblingCount: 1,
  };

  it('clamps the control reach into the documented band', () => {
    expect(controlReach({ ...base, p1: { x: 10, y: 0 } })).toBeLessThanOrEqual(MAX_CONTROL_REACH);
    expect(controlReach({ ...base, p1: { x: 4000, y: 0 }, n1: { x: 1, y: 0 } })).toBe(
      MAX_CONTROL_REACH,
    );
    expect(controlReach({ ...base, p0: { x: 0, y: 0 }, p1: { x: 5000, y: 0 } })).toBe(
      MAX_CONTROL_REACH,
    );
    expect(MIN_CONTROL_REACH).toBeLessThan(MAX_CONTROL_REACH);
  });

  it('shrinks the reach when facing ports would overshoot', () => {
    const short = controlReach({ ...base, p1: { x: 30, y: 0 } });
    expect(short).toBe(15);
  });

  it('leaves along the source normal and enters along the target normal', () => {
    const [, curve] = routeCurved(base);
    expect(curve).toMatchObject({ t: 'C' });
    if (curve?.t !== 'C') throw new Error('expected a cubic');
    expect(curve.x1).toBeGreaterThan(0);
    expect(curve.y1).toBeCloseTo(0, 6);
    expect(curve.x2).toBeLessThan(400);
    expect(curve.x).toBe(400);
  });

  it('offsets a parallel sibling perpendicular to the run', () => {
    const [, curve] = routeCurved({ ...base, siblingIndex: 2, siblingCount: 3 });
    if (curve?.t !== 'C') throw new Error('expected a cubic');
    expect(curve.y1).toBeGreaterThan(0);
    expect(curve.y2).toBeGreaterThan(0);
  });

  it('runs a Catmull-Rom spline through waypoints', () => {
    const cmds = routeCurved({ ...base, waypoints: [{ x: 200, y: 120 }] });
    expect(cmds).toHaveLength(3);
    expect(cmds[cmds.length - 1]).toMatchObject({ t: 'C', x: 400, y: 0 });
  });
});

describe('catmullRomToBezier', () => {
  it('returns a bare move for a single point', () => {
    expect(catmullRomToBezier([{ x: 1, y: 2 }], 0.5)).toEqual([{ t: 'M', x: 1, y: 2 }]);
  });

  it('chains one cubic per span and ends on the last point', () => {
    const cmds = catmullRomToBezier(
      [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 0 },
      ],
      0.5,
    );
    expect(cmds).toHaveLength(3);
    expect(cmds[2]).toMatchObject({ t: 'C', x: 100, y: 0 });
  });
});

describe('routeSelfLoop', () => {
  const box: NodeBox = { id: 'a', x: 0, y: 0, w: 200, h: 100, radius: 8 };

  it('walks the four sides and then grows concentric rings', () => {
    expect([0, 1, 2, 3, 4].map(selfLoopSide)).toEqual(['right', 'top', 'left', 'bottom', 'right']);
    expect(selfLoopRadius(0)).toBe(SELF_LOOP_RADIUS);
    expect(selfLoopRadius(4)).toBe(SELF_LOOP_RADIUS + SELF_LOOP_RING_STEP);
  });

  it('starts and ends on the same side of the card', () => {
    const [move, curve] = routeSelfLoop(box, 0);
    expect(move).toEqual({ t: 'M', x: 200, y: 35 });
    if (curve?.t !== 'C') throw new Error('expected a cubic');
    expect(curve.x).toBe(200);
    expect(curve.y).toBe(65);
    // The loop bulges away from the card.
    expect(curve.x1).toBeGreaterThan(200);
    expect(curve.x2).toBeGreaterThan(200);
  });
});
