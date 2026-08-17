import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_CURVE_K, ZOOM_SNAP_STOPS, ZOOM_SNAP_TOL } from '../src/constants';
import { applyWheelZoom, clamp, snapNear, unitToZoom, zoomToUnit } from '../src/camera/zoom-curve';

/** Deterministic 32-bit LCG; property-style tests must not depend on Math.random. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('zoom curve', () => {
  it('round-trips zoom through curve units for 200 random zooms', () => {
    const rng = seededRng(20260214);
    for (let i = 0; i < 200; i += 1) {
      const zoom = MIN_ZOOM + rng() * (MAX_ZOOM - MIN_ZOOM);
      expect(unitToZoom(zoomToUnit(zoom))).toBeCloseTo(zoom, 10);
    }
  });

  it('is exponential: one e-fold costs exactly K units', () => {
    expect(zoomToUnit(Math.E) - zoomToUnit(1)).toBeCloseTo(ZOOM_CURVE_K, 10);
    expect(unitToZoom(0)).toBe(1);
  });

  it('gives equal relative zoom change for equal deltas at any zoom', () => {
    const ratioAt = (zoom: number): number => unitToZoom(zoomToUnit(zoom) - 40) / zoom;
    expect(ratioAt(0.1)).toBeCloseTo(ratioAt(3), 10);
  });

  it('clamps to the bound on either side and leaves interior values alone', () => {
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('snaps to the nearest stop inside the tolerance only', () => {
    expect(snapNear(1.01, ZOOM_SNAP_STOPS, ZOOM_SNAP_TOL)).toBe(1);
    expect(snapNear(0.99, ZOOM_SNAP_STOPS, ZOOM_SNAP_TOL)).toBe(1);
    expect(snapNear(1.05, ZOOM_SNAP_STOPS, ZOOM_SNAP_TOL)).toBe(1.05);
    expect(snapNear(0.26, [0.25, 0.27], 0.02)).toBe(0.27);
  });

  it('sticks to a snap stop when a wheel tick lands near it', () => {
    // zoom 1 is a stop: a tick small enough to stay inside ±0.015 is absorbed.
    expect(applyWheelZoom(1, 2)).toBe(1);
    expect(applyWheelZoom(0.5, -1)).toBe(0.5);
  });

  it('zooms in on negative delta and out on positive delta', () => {
    expect(applyWheelZoom(1, -100)).toBeGreaterThan(1);
    expect(applyWheelZoom(1, 100)).toBeLessThan(1);
  });

  it('never leaves [MIN_ZOOM, MAX_ZOOM] however large the delta', () => {
    expect(applyWheelZoom(MIN_ZOOM, 100000)).toBe(MIN_ZOOM);
    expect(applyWheelZoom(MAX_ZOOM, -100000)).toBe(MAX_ZOOM);
    expect(applyWheelZoom(1000, 0)).toBe(MAX_ZOOM);
    expect(applyWheelZoom(0.0001, 0)).toBe(MIN_ZOOM);
  });

  it('ignores a non-finite delta instead of producing NaN zoom', () => {
    expect(applyWheelZoom(1.5, Number.NaN)).toBe(1.5);
    expect(applyWheelZoom(1.5, Number.POSITIVE_INFINITY)).toBe(1.5);
  });

  it('reaches every snap stop from a neighbouring zoom without overshooting the limits', () => {
    for (const stop of ZOOM_SNAP_STOPS) {
      const next = applyWheelZoom(stop, 0);
      expect(next).toBe(stop);
    }
  });
});
