import { describe, expect, it } from 'vitest';

import {
  ORTHOGONAL_CATEGORIES,
  SMART_ALIGN_TOLERANCE,
  chooseSmartMode,
  corridorBBox,
  countObstacles,
  degradesToStraight,
  type NodeBox,
  type ObstacleSource,
} from '../src/edges/index.ts';

const box = (id: string, x: number, y: number): NodeBox => ({
  id,
  x,
  y,
  w: 100,
  h: 60,
  radius: 8,
});

const obstaclesOf = (boxes: readonly NodeBox[]): ObstacleSource => ({ query: () => boxes });

describe('countObstacles', () => {
  it('ignores the endpoints themselves', () => {
    const source = box('a', 0, 0);
    const target = box('b', 600, 0);
    expect(countObstacles({ source, target, obstacles: obstaclesOf([source, target]) })).toBe(0);
  });

  it('counts foreign boxes inside the corridor only', () => {
    const source = box('a', 0, 0);
    const target = box('b', 600, 0);
    const inside = box('c', 300, 0);
    const far = box('d', 300, 5000);
    expect(countObstacles({ source, target, obstacles: obstaclesOf([inside, far]) })).toBe(1);
  });

  it('is zero without an obstacle source', () => {
    expect(countObstacles({ source: box('a', 0, 0), target: box('b', 600, 0) })).toBe(0);
  });

  it('exposes the corridor box', () => {
    expect(corridorBBox(box('a', 0, 0), box('b', 200, 100))).toEqual({
      minX: 50,
      minY: 30,
      maxX: 250,
      maxY: 130,
    });
  });
});

describe('chooseSmartMode', () => {
  it('draws very short edges straight', () => {
    expect(chooseSmartMode({ source: box('a', 0, 0), target: box('b', 20, 0) }).mode).toBe(
      'straight',
    );
  });

  it('draws aligned, unobstructed edges straight', () => {
    const decision = chooseSmartMode({ source: box('a', 0, 0), target: box('b', 600, 0) });
    expect(decision.mode).toBe('straight');
    expect(Math.abs(0)).toBeLessThan(SMART_ALIGN_TOLERANCE);
  });

  it('curves an unobstructed diagonal', () => {
    expect(chooseSmartMode({ source: box('a', 0, 0), target: box('b', 600, 400) }).mode).toBe(
      'curved',
    );
  });

  it('prefers right angles for infrastructure-like categories', () => {
    const decision = chooseSmartMode({
      source: box('a', 0, 0),
      target: box('b', 600, 400),
      category: ORTHOGONAL_CATEGORIES[0],
      obstacles: obstaclesOf([box('c', 300, 200)]),
    });
    expect(decision.mode).toBe('orthogonal');
    expect(decision.obstacles).toBe(1);
  });

  it('bows around one or two obstacles with an auto-waypoint', () => {
    const decision = chooseSmartMode({
      source: box('a', 0, 0),
      target: box('b', 600, 400),
      category: 'social',
      obstacles: obstaclesOf([box('c', 300, 200)]),
    });
    expect(decision.mode).toBe('curved');
    expect(decision.autoWaypointPush).toBe(52);
  });

  it('goes orthogonal in a crowded corridor', () => {
    const decision = chooseSmartMode({
      source: box('a', 0, 0),
      target: box('b', 600, 400),
      obstacles: obstaclesOf([box('c', 200, 150), box('d', 300, 200), box('e', 400, 250)]),
    });
    expect(decision.mode).toBe('orthogonal');
    expect(decision.autoWaypointPush).toBeNull();
  });
});

describe('degradesToStraight', () => {
  it('measures the length on screen, not in the world', () => {
    expect(degradesToStraight(100, 0.2)).toBe(true);
    expect(degradesToStraight(100, 1)).toBe(false);
  });
});
