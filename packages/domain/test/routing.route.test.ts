import { describe, expect, it } from 'vitest';

import {
  MAX_REGION_OBSTACLES,
  insideRoundedBox,
  pointCount,
  resetRouteRevisions,
  resolveMode,
  route,
  withRouteDefaults,
  type NodeBox,
  type ObstacleSource,
  type RouteInput,
} from '../src/edges/index.ts';

const source: NodeBox = { id: 'a', x: 0, y: 0, w: 160, h: 90, radius: 10 };
const target: NodeBox = { id: 'b', x: 600, y: 320, w: 160, h: 90, radius: 10 };

const input = (patch: Partial<RouteInput> = {}): RouteInput =>
  withRouteDefaults({ source, target, ...patch });

const obstacle: NodeBox = { id: 'c', x: 300, y: 100, w: 120, h: 260, radius: 8 };
const obstacles: ObstacleSource = { query: () => [source, target, obstacle] };

describe('resolveMode', () => {
  it('honours an explicit mode', () => {
    expect(resolveMode(input({ mode: 'orthogonal' }))).toBe('orthogonal');
  });

  it('degrades any mode to straight below 40 screen px', () => {
    expect(resolveMode(input({ mode: 'curved', zoom: 0.02 }))).toBe('straight');
  });

  it('asks the chooser for smart edges', () => {
    expect(resolveMode(input({ mode: 'smart' }))).toBe('curved');
  });

  it('keeps a hand-routed edge on a curve, or on right angles when it asked for them', () => {
    expect(resolveMode(input({ manualRoute: true, mode: 'straight' }))).toBe('curved');
    expect(resolveMode(input({ manualRoute: true, mode: 'orthogonal' }))).toBe('orthogonal');
  });
});

describe('route', () => {
  it('clips both endpoints outside the two cards', () => {
    const geometry = route(input({ mode: 'straight' }));
    expect(insideRoundedBox(geometry.startPoint, source)).toBe(false);
    expect(insideRoundedBox(geometry.endPoint, target)).toBe(false);
    expect(geometry.kind).toBe('line');
    expect(geometry.length).toBeGreaterThan(0);
    expect(geometry.degraded).toBe(false);
  });

  it('reports the ports it resolved', () => {
    const geometry = route(input({ mode: 'orthogonal' }));
    expect(geometry.srcPort.t).toBe(0.5);
    expect(geometry.dstPort.t).toBe(0.5);
    expect(geometry.kind).toBe('poly');
  });

  it('bounds the geometry by its own flattened polyline', () => {
    const geometry = route(input({ mode: 'curved' }));
    for (let i = 0; i < pointCount(geometry.flat); i += 1) {
      const x = geometry.flat[i * 2] as number;
      const y = geometry.flat[i * 2 + 1] as number;
      expect(x).toBeGreaterThanOrEqual(geometry.bbox.minX);
      expect(x).toBeLessThanOrEqual(geometry.bbox.maxX);
      expect(y).toBeGreaterThanOrEqual(geometry.bbox.minY);
      expect(y).toBeLessThanOrEqual(geometry.bbox.maxY);
    }
  });

  it('flattens fewer points in draft quality', () => {
    const full = route(input({ mode: 'curved', quality: 'full' }));
    const draft = route(input({ mode: 'curved', quality: 'draft' }));
    expect(pointCount(draft.flat)).toBeLessThanOrEqual(pointCount(full.flat));
  });

  it('routes around an obstacle when asked for right angles', () => {
    const geometry = route(input({ mode: 'orthogonal', obstacles }));
    expect(geometry.mode).toBe('orthogonal');
    expect(geometry.cmds.length).toBeGreaterThan(2);
  });

  it('uses the Z fallback when no obstacle source is available', () => {
    const geometry = route(input({ mode: 'orthogonal' }));
    expect(geometry.cmds.some((c) => c.t === 'Q')).toBe(true);
  });

  it('keeps a manual route through its waypoints', () => {
    const geometry = route(
      input({ manualRoute: true, waypoints: [{ x: 300, y: 500 }], mode: 'curved' }),
    );
    expect(geometry.bbox.maxY).toBeGreaterThan(400);
  });

  it('draws a self-loop for an edge whose endpoints are the same card', () => {
    const geometry = route(input({ target: source }));
    expect(geometry.kind).toBe('bezier');
    expect(geometry.srcPort.side).toBe('right');
    expect(geometry.length).toBeGreaterThan(0);
  });

  it('places the label anchor along the path', () => {
    const geometry = route(input({ mode: 'straight', labelPosition: 0.5 }));
    const midX = (geometry.startPoint.x + geometry.endPoint.x) / 2;
    expect(geometry.labelAnchor.x).toBeCloseTo(midX, 0);
  });

  it('increments the revision on every recompute', () => {
    resetRouteRevisions();
    const first = route(input({ mode: 'straight' }));
    const second = route(input({ mode: 'straight' }));
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
  });

  it('separates parallel edges', () => {
    const left = route(input({ mode: 'straight', siblingIndex: 0, siblingCount: 3 }));
    const right = route(input({ mode: 'straight', siblingIndex: 2, siblingCount: 3 }));
    expect(left.labelAnchor.x).not.toBeCloseTo(right.labelAnchor.x, 3);
  });

  it('adds the smart auto-waypoint when the corridor has a couple of obstacles', () => {
    const plain = route(input({ mode: 'curved' }));
    const bowed = route(input({ mode: 'smart', obstacles }));
    expect(bowed.mode).toBe('curved');
    expect(bowed.length).toBeGreaterThan(plain.length);
  });
});

describe('withRouteDefaults', () => {
  it('fills every knob and keeps an obstacle source when given', () => {
    const filled = withRouteDefaults({ source, target });
    expect(filled.mode).toBe('smart');
    expect(filled.quality).toBe('full');
    expect(filled.obstacles).toBeUndefined();
    expect(withRouteDefaults({ source, target, obstacles }).obstacles).toBe(obstacles);
  });
});

describe('bounded work per edge', () => {
  it('only reasons about the nearest cards when the region is crowded', () => {
    const boxes: NodeBox[] = [];
    for (let i = 0; i < 400; i += 1) {
      boxes.push({
        id: `n${i}`,
        x: 200 + (i % 20) * 20,
        y: 100 + Math.floor(i / 20) * 15,
        w: 12,
        h: 10,
        radius: 0,
      });
    }
    let seen = 0;
    const obstacles: ObstacleSource = {
      query: () => {
        seen += 1;
        return boxes;
      },
    };
    const started = Date.now();
    const geometry = route(input({ mode: 'orthogonal', obstacles }));
    expect(seen).toBeGreaterThan(0);
    expect(geometry.flat.length).toBeGreaterThanOrEqual(4);
    // The cap is what keeps a dense board affordable; without it the lattice explodes.
    expect(MAX_REGION_OBSTACLES).toBeLessThanOrEqual(64);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
