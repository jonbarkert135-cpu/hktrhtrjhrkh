import { describe, expect, it } from 'vitest';

import {
  LABEL_MAX_CHARS_L2,
  LABEL_MAX_CHARS_L3,
  UniformHash,
  compareLabelPriority,
  labelAnchor,
  placeLabels,
  route,
  truncateLabel,
  withRouteDefaults,
  type EdgeGeometry,
  type LabelCandidate,
  type NodeBox,
} from '../src/edges/index.ts';

const source: NodeBox = { id: 'a', x: 0, y: 0, w: 100, h: 60, radius: 0 };
const target: NodeBox = { id: 'b', x: 400, y: 0, w: 100, h: 60, radius: 0 };
const geometry: EdgeGeometry = route(withRouteDefaults({ source, target, mode: 'straight' }));

const candidate = (id: string, patch: Partial<LabelCandidate> = {}): LabelCandidate => ({
  id,
  text: id,
  geometry,
  t: 0.5,
  ...patch,
});

describe('labelAnchor', () => {
  it('sits on the path when there is no offset', () => {
    const anchor = labelAnchor(geometry, 0.5);
    expect(anchor.y).toBeCloseTo(30, 3);
    expect(anchor.angle).toBeCloseTo(0, 3);
  });

  it('applies the offset in the edge-local frame', () => {
    const anchor = labelAnchor(geometry, 0.5, { x: 0, y: -10 });
    // The edge runs left→right, so a negative local y pushes the chip upwards.
    expect(anchor.y).toBeCloseTo(20, 3);
  });
});

describe('truncateLabel', () => {
  it('keeps short text and ellipsizes long text', () => {
    expect(truncateLabel('short', LABEL_MAX_CHARS_L2)).toBe('short');
    const long = 'x'.repeat(60);
    expect([...truncateLabel(long, LABEL_MAX_CHARS_L2)]).toHaveLength(LABEL_MAX_CHARS_L2);
    expect(truncateLabel(long, LABEL_MAX_CHARS_L3).endsWith('…')).toBe(true);
  });
});

describe('compareLabelPriority', () => {
  it('orders selected, then hovered, then confidence, weight and id', () => {
    const order = [
      candidate('d'),
      candidate('c', { weight: 2 }),
      candidate('b', { hovered: true }),
      candidate('a', { selected: true }),
    ]
      .sort(compareLabelPriority)
      .map((c) => c.id);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(
      [candidate('y', { confidenceRank: 1 }), candidate('x')].sort(compareLabelPriority)[0]?.id,
    ).toBe('y');
  });
});

describe('placeLabels', () => {
  const options = {
    toScreen: (p: { x: number; y: number }) => p,
    measure: () => ({ w: 60, h: 18 }),
  };

  it('places a lone label on its anchor', () => {
    const [placed] = placeLabels([candidate('e1')], options);
    expect(placed?.dotFallback).toBe(false);
    expect(placed?.box.w).toBe(60);
  });

  it('slides a competing label off the first slot instead of overlapping', () => {
    const placed = placeLabels([candidate('e1'), candidate('e2')], options);
    expect(placed).toHaveLength(2);
    const [first, second] = placed;
    expect(first?.box.x === second?.box.x && first?.box.y === second?.box.y).toBe(false);
  });

  it('avoids the node cards', () => {
    const placed = placeLabels([candidate('e1')], {
      ...options,
      nodeBoxes: [{ x: 0, y: 0, w: 1000, h: 40 }],
    });
    expect((placed[0]?.box.y ?? 0) > 40 || placed[0]?.dotFallback === true).toBe(true);
  });

  it('falls back to a dot when nothing fits', () => {
    const placed = placeLabels([candidate('e1')], {
      ...options,
      nodeBoxes: [{ x: -5000, y: -5000, w: 10000, h: 10000 }],
    });
    expect(placed[0]?.dotFallback).toBe(true);
    expect(placed[0]?.box.w).toBe(3);
  });

  it('honours the per-frame budget', () => {
    const many = Array.from({ length: 10 }, (_, i) => candidate(`e${i}`));
    expect(placeLabels(many, { ...options, budget: 4 })).toHaveLength(4);
  });
});

describe('UniformHash', () => {
  it('reports overlap only for boxes that really intersect', () => {
    const hash = new UniformHash(48, 24);
    hash.insert({ x: 0, y: 0, w: 40, h: 20 });
    expect(hash.isFree({ x: 20, y: 10, w: 40, h: 20 })).toBe(false);
    expect(hash.isFree({ x: 100, y: 100, w: 40, h: 20 })).toBe(true);
  });
});
