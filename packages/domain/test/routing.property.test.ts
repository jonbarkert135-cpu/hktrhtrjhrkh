/**
 * Invariants that must hold for *any* board, whatever the router does internally (18_TESTING.md
 * §6). These are the properties a user notices when they break: a line that starts inside a card,
 * a path that cannot be clicked, geometry that is not reproducible.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  hitTolerance,
  insideRoundedBox,
  isEdgeHit,
  nearestPointOnEdge,
  pointAtIndex,
  pointCount,
  polylineLength,
  route,
  withRouteDefaults,
  type NodeBox,
  type RoutingMode,
} from '../src/edges/index.ts';

const boxArb = (id: string): fc.Arbitrary<NodeBox> =>
  fc
    .record({
      x: fc.integer({ min: -2000, max: 2000 }),
      y: fc.integer({ min: -2000, max: 2000 }),
      w: fc.integer({ min: 60, max: 320 }),
      h: fc.integer({ min: 40, max: 200 }),
      radius: fc.constantFrom(0, 8, 16),
    })
    .map((box) => ({ id, ...box }));

const modeArb = fc.constantFrom<RoutingMode>('straight', 'curved', 'orthogonal', 'smart');

/** Boards where the two cards are far enough apart that clipping is meaningful. */
const pairArb = fc
  .tuple(boxArb('a'), boxArb('b'), modeArb, fc.integer({ min: 0, max: 3 }))
  .filter(([a, b]) => Math.hypot(a.x - b.x, a.y - b.y) > 400);

describe('routing invariants', () => {
  it('never starts or ends inside one of the two cards', () => {
    fc.assert(
      fc.property(pairArb, ([source, target, mode, sibling]) => {
        const geometry = route(
          withRouteDefaults({
            source,
            target,
            mode,
            siblingIndex: sibling,
            siblingCount: sibling + 1,
          }),
        );
        expect(insideRoundedBox(geometry.startPoint, source)).toBe(false);
        expect(insideRoundedBox(geometry.endPoint, target)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('produces a finite, non-empty, measurable polyline', () => {
    fc.assert(
      fc.property(pairArb, ([source, target, mode]) => {
        const geometry = route(withRouteDefaults({ source, target, mode }));
        expect(pointCount(geometry.flat)).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < pointCount(geometry.flat); i += 1) {
          const p = pointAtIndex(geometry.flat, i);
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        }
        expect(geometry.length).toBeCloseTo(polylineLength(geometry.flat), 3);
        expect(geometry.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it('is hit-testable at its own label anchor', () => {
    fc.assert(
      fc.property(pairArb, ([source, target, mode]) => {
        const geometry = route(withRouteDefaults({ source, target, mode }));
        expect(isEdgeHit(geometry, geometry.labelAnchor, hitTolerance(1))).toBe(true);
        const near = nearestPointOnEdge(geometry, geometry.labelAnchor);
        expect(near.distance).toBeLessThan(1);
        expect(near.t).toBeGreaterThanOrEqual(0);
        expect(near.t).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic: the same input routes to the same geometry', () => {
    fc.assert(
      fc.property(pairArb, ([source, target, mode]) => {
        const a = route(withRouteDefaults({ source, target, mode }));
        const b = route(withRouteDefaults({ source, target, mode }));
        expect([...a.flat]).toEqual([...b.flat]);
        expect(a.revision).toBeLessThan(b.revision);
      }),
      { numRuns: 100 },
    );
  });
});
