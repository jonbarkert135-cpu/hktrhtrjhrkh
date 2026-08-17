/**
 * The non-linear zoom curve (05_CANVAS_ENGINE.md §5.3). Zoom is exponential in a normalized
 * "zoom unit" so a wheel delta feels the same at 0.1× and at 4×; every camera animation
 * interpolates in this unit space too (§5.4).
 */

import { MAX_ZOOM, MIN_ZOOM, ZOOM_CURVE_K, ZOOM_SNAP_STOPS, ZOOM_SNAP_TOL } from '../constants';

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Zoom → curve units. Non-positive zoom is not representable; callers clamp first. */
export function zoomToUnit(zoom: number): number {
  return Math.log(zoom) * ZOOM_CURVE_K;
}

export function unitToZoom(unit: number): number {
  return Math.exp(unit / ZOOM_CURVE_K);
}

/** Returns the nearest stop within `tolerance`, otherwise `value` unchanged. */
export function snapNear(value: number, stops: readonly number[], tolerance: number): number {
  let best = value;
  let bestDistance = tolerance;
  for (const stop of stops) {
    const distance = Math.abs(value - stop);
    if (distance <= bestDistance) {
      best = stop;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Wheel zoom for one gesture tick. `deltaPx` is the normalized wheel delta in px
 * (camera/input-normalize.ts): scrolling down (positive) zooms out.
 */
export function applyWheelZoom(zoom: number, deltaPx: number): number {
  const base = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  if (!Number.isFinite(deltaPx)) return base;
  const next = unitToZoom(zoomToUnit(base) - deltaPx);
  return clamp(snapNear(next, ZOOM_SNAP_STOPS, ZOOM_SNAP_TOL), MIN_ZOOM, MAX_ZOOM);
}
