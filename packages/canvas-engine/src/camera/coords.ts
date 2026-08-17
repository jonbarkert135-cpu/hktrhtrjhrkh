/**
 * Pure world↔screen conversions (05_CANVAS_ENGINE.md §4). No state, no DOM, no allocation beyond
 * the returned object. Every other module converts through here — ad-hoc arithmetic elsewhere is
 * what produces the half-pixel mismatches §4 warns about.
 *
 * `camera.x/y` is the world coordinate of the container's top-left corner.
 */

import { MAX_DPR } from '../constants';
import type { CameraState, Rect, Vec2 } from '../types';

export function worldToScreen(camera: Readonly<CameraState>, p: Vec2): Vec2 {
  return { x: (p.x - camera.x) * camera.zoom, y: (p.y - camera.y) * camera.zoom };
}

export function screenToWorld(camera: Readonly<CameraState>, p: Vec2): Vec2 {
  return { x: p.x / camera.zoom + camera.x, y: p.y / camera.zoom + camera.y };
}

export function worldRectToScreen(camera: Readonly<CameraState>, r: Rect): Rect {
  return {
    x: (r.x - camera.x) * camera.zoom,
    y: (r.y - camera.y) * camera.zoom,
    w: r.w * camera.zoom,
    h: r.h * camera.zoom,
  };
}

export function screenRectToWorld(camera: Readonly<CameraState>, r: Rect): Rect {
  return {
    x: r.x / camera.zoom + camera.x,
    y: r.y / camera.zoom + camera.y,
    w: r.w / camera.zoom,
    h: r.h / camera.zoom,
  };
}

/** The viewport in world space: a subtraction with no half-size terms, by §4's camera choice. */
export function viewportWorldRect(
  camera: Readonly<CameraState>,
  widthCss: number,
  heightCss: number,
): Rect {
  return { x: camera.x, y: camera.y, w: widthCss / camera.zoom, h: heightCss / camera.zoom };
}

/** Inflate a rect by `by` world px on every side (culling ring, focus padding, bounds margin). */
export function inflateRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Backing-store scale factor: `min(devicePixelRatio, MAX_DPR)`, never below 1. Above 2 the fill
 * cost triples for no perceptible gain on flat shapes (05 §4, 16_PERFORMANCE.md §3.1).
 * Hosts that cannot report a ratio (Node, older jsdom) pass `undefined` and get 1.
 */
export function resolveDpr(devicePixelRatio: number | undefined): number {
  if (typeof devicePixelRatio !== 'number' || !Number.isFinite(devicePixelRatio)) return 1;
  return Math.min(Math.max(devicePixelRatio, 1), MAX_DPR);
}
