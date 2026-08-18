import { describe, expect, it } from 'vitest';

import { EdgeSchema, makeEdge, type BoardEdge } from '../src/entities/edge.ts';
import {
  CONFIDENCE_OPACITY,
  DEFAULT_CORNER_RADIUS,
  DEFAULT_CURVATURE,
  EdgeTypeRegistry,
  MAX_STROKE_WIDTH,
  MIN_STROKE_WIDTH,
  PAST_EDGE_OPACITY_FACTOR,
  dashPattern,
  isPastEdge,
  registerEdgeBuiltins,
  resolveEdgeVisual,
} from '../src/edges/index.ts';

const NOW = '2026-08-18T00:00:00.000Z';
const CLOCK = new Date(NOW);
const registry: EdgeTypeRegistry = registerEdgeBuiltins(new EdgeTypeRegistry());

const edgeOf = (patch: Partial<BoardEdge> = {}, type = 'references'): BoardEdge =>
  EdgeSchema.parse({ ...makeEdge({ id: 'e1', from: 'a', to: 'b', type }, NOW), ...patch });

describe('resolveEdgeVisual', () => {
  it('takes the type defaults when the edge overrides nothing', () => {
    const visual = resolveEdgeVisual(edgeOf(), registry.get('references'), CLOCK);
    expect(visual.routing).toBe('smart');
    expect(visual.strokeToken).toBe('--edge-neutral');
    expect(visual.arrowTarget).toBe('arrow');
    expect(visual.curvature).toBe(DEFAULT_CURVATURE);
    expect(visual.cornerRadius).toBe(DEFAULT_CORNER_RADIUS);
  });

  it('lets the edge override routing, colour, width and animation', () => {
    const visual = resolveEdgeVisual(
      edgeOf({
        style: EdgeSchema.shape.style.parse({
          routing: 'orthogonal',
          stroke: '--edge-danger',
          width: 3,
          animated: true,
          cornerRadius: 20,
          curvature: 0.8,
          zBias: 2,
        }),
      }),
      registry.get('references'),
      CLOCK,
    );
    expect(visual).toMatchObject({
      routing: 'orthogonal',
      strokeToken: '--edge-danger',
      width: 3,
      animated: true,
      cornerRadius: 20,
      curvature: 0.8,
      zBias: 2,
    });
  });

  it('maps weight to stroke width inside the clamp', () => {
    const thin = resolveEdgeVisual(edgeOf({ weight: 0 }), registry.get('knows'), CLOCK);
    const thick = resolveEdgeVisual(edgeOf({ weight: 1 }), registry.get('same_as'), CLOCK);
    expect(thin.width).toBeGreaterThanOrEqual(MIN_STROKE_WIDTH);
    expect(thick.width).toBeLessThanOrEqual(MAX_STROKE_WIDTH);
    expect(thick.width).toBeGreaterThan(thin.width);
  });

  it('maps confidence to opacity and dashes weak claims', () => {
    const high = resolveEdgeVisual(edgeOf({ confidence: 'high' }), registry.get('owns'), CLOCK);
    const weak = resolveEdgeVisual(edgeOf({ confidence: 'low' }), registry.get('owns'), CLOCK);
    expect(high.opacity).toBe(CONFIDENCE_OPACITY.high);
    expect(high.dash).toBe('solid');
    expect(weak.opacity).toBe(CONFIDENCE_OPACITY.low);
    expect(weak.dash).toBe('dashed');
  });

  it('keeps a type that is already dotted dotted, whatever the confidence', () => {
    const visual = resolveEdgeVisual(
      edgeOf({ confidence: 'unknown' }, 'mentions'),
      registry.get('mentions'),
      CLOCK,
    );
    expect(visual.dash).toBe('dotted');
  });

  it('treats a numeric dash override as a dashed stroke', () => {
    const visual = resolveEdgeVisual(
      edgeOf({ style: EdgeSchema.shape.style.parse({ dash: [4, 4] }) }),
      registry.get('references'),
      CLOCK,
    );
    expect(visual.dash).toBe('dashed');
  });

  it('never paints an arrowhead on an undirected edge, and honours an explicit removal', () => {
    const undirected = resolveEdgeVisual(
      edgeOf({ directed: false }, 'knows'),
      registry.get('knows'),
      CLOCK,
    );
    expect(undirected.arrowTarget).toBe('none');

    const dotted = resolveEdgeVisual(
      edgeOf({ directed: false }, 'same_as'),
      registry.get('same_as'),
      CLOCK,
    );
    expect(dotted.arrowSource).toBe('dot');

    const removed = resolveEdgeVisual(
      edgeOf({ style: EdgeSchema.shape.style.parse({ arrowTarget: false }) }),
      registry.get('references'),
      CLOCK,
    );
    expect(removed.arrowTarget).toBe('none');

    const added = resolveEdgeVisual(
      edgeOf({ style: EdgeSchema.shape.style.parse({ arrowSource: true }) }),
      registry.get('references'),
      CLOCK,
    );
    expect(added.arrowSource).toBe('arrow');
  });

  it('fades a relationship that has ended', () => {
    const past = edgeOf({ validTo: '2020-01-01T00:00:00.000Z', confidence: 'high' });
    expect(isPastEdge(past, CLOCK)).toBe(true);
    const visual = resolveEdgeVisual(past, registry.get('references'), CLOCK);
    expect(visual.opacity).toBeCloseTo(CONFIDENCE_OPACITY.high * PAST_EDGE_OPACITY_FACTOR, 6);
  });

  it('treats an ongoing or unparseable validity as present', () => {
    expect(isPastEdge(edgeOf(), CLOCK)).toBe(false);
    // A value that never passes the schema can still arrive from an older client's export.
    expect(isPastEdge({ ...edgeOf(), validTo: 'not a date' }, CLOCK)).toBe(false);
  });
});

describe('dashPattern', () => {
  it('returns null for a solid stroke and a pattern for the rest', () => {
    expect(dashPattern('solid', 2)).toBeNull();
    expect(dashPattern('dashed', 2)).toEqual([8, 6]);
    expect(dashPattern('dotted', 2)).toEqual([2, 4]);
    expect(dashPattern('dash-dot', 2)).toEqual([8, 4, 2, 4]);
  });
});
