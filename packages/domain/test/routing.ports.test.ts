import { describe, expect, it } from 'vitest';

import {
  HYSTERESIS_MARGIN,
  materializePort,
  portPoint,
  resolvePort,
  sideLength,
  sideNormal,
  sideTangent,
  type NodeBox,
} from '../src/edges/index.ts';

const box = (patch: Partial<NodeBox> = {}): NodeBox => ({
  id: 'n',
  x: 0,
  y: 0,
  w: 200,
  h: 100,
  radius: 8,
  ...patch,
});

describe('side geometry', () => {
  it('exposes outward normals and tangents', () => {
    expect(sideNormal('top')).toEqual({ x: 0, y: -1 });
    expect(sideNormal('bottom')).toEqual({ x: 0, y: 1 });
    expect(sideNormal('left')).toEqual({ x: -1, y: 0 });
    expect(sideNormal('right')).toEqual({ x: 1, y: 0 });
    expect(sideTangent('top')).toEqual({ x: 1, y: 0 });
    expect(sideTangent('left')).toEqual({ x: 0, y: 1 });
  });

  it('reports the length of each side', () => {
    expect(sideLength(box(), 'top')).toBe(200);
    expect(sideLength(box(), 'left')).toBe(100);
  });

  it('places port points on the border', () => {
    expect(portPoint(box(), { side: 'top', t: 0.5 })).toEqual({ x: 100, y: 0 });
    expect(portPoint(box(), { side: 'bottom', t: 0 })).toEqual({ x: 0, y: 100 });
    expect(portPoint(box(), { side: 'left', t: 1 })).toEqual({ x: 0, y: 100 });
    expect(portPoint(box(), { side: 'right', t: 0.25 })).toEqual({ x: 200, y: 25 });
    // Out-of-range offsets are clamped rather than escaping the card.
    expect(portPoint(box(), { side: 'right', t: 5 })).toEqual({ x: 200, y: 100 });
  });
});

describe('resolvePort', () => {
  const self = box({ id: 'a' });

  it('faces the neighbour', () => {
    expect(resolvePort(self, box({ id: 'b', x: 600, y: 0 })).side).toBe('right');
    expect(resolvePort(self, box({ id: 'b', x: -600, y: 0 })).side).toBe('left');
    expect(resolvePort(self, box({ id: 'b', x: 0, y: -600 })).side).toBe('top');
    expect(resolvePort(self, box({ id: 'b', x: 0, y: 600 })).side).toBe('bottom');
  });

  it('breaks a diagonal tie horizontally, because cards are wider than tall', () => {
    expect(resolvePort(self, box({ id: 'b', x: 400, y: 400 })).side).toBe('right');
  });

  it('slides the offset along the side, clamped away from the corners', () => {
    const port = resolvePort(self, box({ id: 'b', x: 600, y: 20 }));
    expect(port.side).toBe('right');
    expect(port.t).toBeGreaterThan(0.5);
    expect(port.t).toBeLessThanOrEqual(0.85);
    const extreme = resolvePort(self, box({ id: 'b', x: 400, y: 4000 }));
    expect(extreme.t).toBeLessThanOrEqual(0.85);
    expect(extreme.t).toBeGreaterThanOrEqual(0.15);
  });

  it('snaps to the side midpoint for orthogonal routing', () => {
    expect(resolvePort(self, box({ id: 'b', x: 600, y: 90 }), { orthogonal: true })).toEqual({
      side: 'right',
      t: 0.5,
    });
  });

  it('keeps the previous side until the new one wins by the hysteresis margin', () => {
    const nearlyDiagonal = box({ id: 'b', x: 300, y: 305 });
    const fresh = resolvePort(self, nearlyDiagonal).side;
    const sticky = resolvePort(self, nearlyDiagonal, { previous: 'right' }).side;
    expect(fresh).toBe('bottom');
    expect(sticky).toBe('right');
    // A decisive direction overcomes the hysteresis.
    expect(resolvePort(self, box({ id: 'b', x: 5000, y: 0 }), { previous: 'top' }).side).toBe(
      'right',
    );
    expect(HYSTERESIS_MARGIN).toBeGreaterThan(0);
  });
});

describe('materializePort', () => {
  it('passes an explicit port through untouched', () => {
    expect(materializePort(box(), box({ id: 'b', x: 600 }), { side: 'top', t: 0.2 })).toEqual({
      side: 'top',
      t: 0.2,
    });
  });

  it('resolves an auto port', () => {
    expect(materializePort(box(), box({ id: 'b', x: 600 }), { side: 'auto', t: 0.5 }).side).toBe(
      'right',
    );
  });
});
