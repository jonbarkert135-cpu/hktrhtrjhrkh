/**
 * The camera (05_CANVAS_ENGINE.md §5): state, limits, anchored zoom, fit/focus, bounds clamping
 * and animated moves.
 *
 * Animations are interpolated in zoom-unit space (§5.4) and driven exclusively by the injected
 * clock — the module never calls `setTimeout`/`requestAnimationFrame`, so the frame loop (and the
 * tests) own time. `prefers-reduced-motion` turns every animation into an instant jump (N6).
 */

import {
  CAMERA_ANIM_MS,
  CAMERA_BOUNDS_MARGIN,
  FIT_PADDING_PX,
  MAX_WORLD_COORD,
  MAX_ZOOM,
  MIN_ZOOM,
  MIN_ZOOM_FIT,
} from '../constants';
import type { CameraCause, CameraController, CameraState, EntityId, Rect, Vec2 } from '../types';
import { screenToWorld, viewportWorldRect, worldToScreen } from './coords';
import { applyWheelZoom, clamp, unitToZoom, zoomToUnit } from './zoom-curve';

/** `cubic-bezier(0.22, 0.61, 0.36, 1)` from §5.4, as its two control points. */
export const CAMERA_EASE = { x1: 0.22, y1: 0.61, x2: 0.36, y2: 1 } as const;

/** World px added around a focused entity's bounds before fitting (§5.6). */
export const FOCUS_PADDING_WORLD = 240;
export const FOCUS_MAX_ZOOM = 1.2;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface CameraOptions {
  /** Initial camera; defaults to the reset state. */
  state?: Readonly<CameraState>;
  viewport: ViewportSize;
  clock: { now(): number };
  prefersReducedMotion: boolean;
  onChange?: (state: Readonly<CameraState>, cause: CameraCause) => void;
  /** Scene bounds resolver for `fitAll` and `clampToBounds`; absent scene → `reset()`. */
  sceneBounds?: () => Rect | null;
  /** Entity bounds resolver for `focus`; unknown ids are ignored. */
  entityBounds?: (id: EntityId) => Rect | null;
}

export interface Camera extends CameraController {
  setViewportSize(width: number, height: number): void;
  setState(next: Readonly<CameraState>, cause: CameraCause): void;
  cancelAnimation(): void;
  readonly isAnimating: boolean;
  /** Advances an in-flight animation; returns true while more frames are needed. */
  tickAnimation(now: number): boolean;
  clampToBounds(sceneBounds: Rect): void;
}

interface Animation {
  fromUnit: number;
  toUnit: number;
  fromCentre: Vec2;
  toCentre: Vec2;
  startedAt: number;
  cause: CameraCause;
}

const RESET_STATE: CameraState = { x: 0, y: 0, zoom: 1 };

/** Bisection on the bezier's x(t); 24 iterations is < 1e-7 in t and costs nothing at 60 fps. */
function ease(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const { x1, y1, x2, y2 } = CAMERA_EASE;
  const axis = (a: number, b: number, t: number): number => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (axis(x1, x2, mid) < progress) lo = mid;
    else hi = mid;
  }
  return axis(y1, y2, (lo + hi) / 2);
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function createCamera(options: CameraOptions): Camera {
  const { clock, onChange, sceneBounds, entityBounds } = options;
  let width = Math.max(0, finite(options.viewport.width, 0));
  let height = Math.max(0, finite(options.viewport.height, 0));
  const prefersReducedMotion = options.prefersReducedMotion;
  const state: CameraState = normalize(options.state ?? RESET_STATE, MIN_ZOOM_FIT);
  let animation: Animation | null = null;

  function normalize(next: Readonly<CameraState>, minZoom: number): CameraState {
    return {
      x: clamp(finite(next.x, 0), -MAX_WORLD_COORD, MAX_WORLD_COORD),
      y: clamp(finite(next.y, 0), -MAX_WORLD_COORD, MAX_WORLD_COORD),
      zoom: clamp(finite(next.zoom, 1), minZoom, MAX_ZOOM),
    };
  }

  function commit(next: Readonly<CameraState>, cause: CameraCause, minZoom = MIN_ZOOM): void {
    const clamped = normalize(next, minZoom);
    if (clamped.x === state.x && clamped.y === state.y && clamped.zoom === state.zoom) return;
    state.x = clamped.x;
    state.y = clamped.y;
    state.zoom = clamped.zoom;
    onChange?.(state, cause);
  }

  function centreOf(camera: Readonly<CameraState>): Vec2 {
    return { x: camera.x + width / (2 * camera.zoom), y: camera.y + height / (2 * camera.zoom) };
  }

  function fromCentre(centre: Vec2, zoom: number): CameraState {
    return { x: centre.x - width / (2 * zoom), y: centre.y - height / (2 * zoom), zoom };
  }

  /** Every user-driven move cancels an in-flight animation on the same frame (§5.4). */
  function cancelAnimation(): void {
    animation = null;
  }

  function moveTo(target: Readonly<CameraState>, cause: CameraCause, animate: boolean): void {
    const goal = normalize(target, MIN_ZOOM_FIT);
    if (!animate || prefersReducedMotion || CAMERA_ANIM_MS <= 0) {
      cancelAnimation();
      commit(goal, cause, MIN_ZOOM_FIT);
      return;
    }
    animation = {
      fromUnit: zoomToUnit(state.zoom),
      toUnit: zoomToUnit(goal.zoom),
      fromCentre: centreOf(state),
      toCentre: centreOf(goal),
      startedAt: clock.now(),
      cause,
    };
  }

  function anchoredZoom(zoom: number, anchorScreen: Vec2, minZoom: number): CameraState {
    const world = screenToWorld(state, anchorScreen);
    const next = clamp(finite(zoom, state.zoom), minZoom, MAX_ZOOM);
    return { zoom: next, x: world.x - anchorScreen.x / next, y: world.y - anchorScreen.y / next };
  }

  function fitRect(rect: Rect, padding: number, maxZoom: number): CameraState {
    const usableW = width - 2 * padding;
    const usableH = height - 2 * padding;
    const byW = rect.w > 0 ? usableW / rect.w : Infinity;
    const byH = rect.h > 0 ? usableH / rect.h : Infinity;
    const zoom = clamp(Math.min(maxZoom, byW, byH), MIN_ZOOM_FIT, MAX_ZOOM);
    return fromCentre({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, zoom);
  }

  const camera: Camera = {
    get state(): Readonly<CameraState> {
      return state;
    },

    panBy(dxScreen: number, dyScreen: number): void {
      cancelAnimation();
      commit(
        {
          x: state.x + finite(dxScreen, 0) / state.zoom,
          y: state.y + finite(dyScreen, 0) / state.zoom,
          zoom: state.zoom,
        },
        'user',
      );
    },

    zoomTo(zoom: number, anchorScreen: Vec2, opts?: { animate?: boolean }): void {
      const animate = opts?.animate === true;
      if (!animate) cancelAnimation();
      moveTo(anchoredZoom(zoom, anchorScreen, MIN_ZOOM), 'user', animate);
    },

    zoomBy(steps: number, anchorScreen: Vec2): void {
      cancelAnimation();
      // Negative delta zooms in, so a positive step count is a zoom-in (§5.3).
      commit(
        anchoredZoom(applyWheelZoom(state.zoom, -finite(steps, 0)), anchorScreen, MIN_ZOOM),
        'user',
      );
    },

    fit(rect: Rect, opts?: { padding?: number; maxZoom?: number; animate?: boolean }): void {
      moveTo(
        fitRect(rect, opts?.padding ?? FIT_PADDING_PX, opts?.maxZoom ?? 1),
        'fit',
        opts?.animate !== false,
      );
    },

    fitAll(opts?: { padding?: number; animate?: boolean }): void {
      const bounds = sceneBounds?.() ?? null;
      // An empty board has no bounds to fit: §5.7 says reset.
      if (bounds === null || bounds.w <= 0 || bounds.h <= 0) {
        moveTo(RESET_STATE, 'reset', opts?.animate !== false);
        return;
      }
      camera.fit(bounds, {
        padding: opts?.padding ?? FIT_PADDING_PX,
        maxZoom: 1,
        animate: opts?.animate !== false,
      });
    },

    focus(id: EntityId, opts?: { zoom?: number; animate?: boolean }): void {
      const bounds = entityBounds?.(id) ?? null;
      if (bounds === null) return;
      const padded: Rect = {
        x: bounds.x - FOCUS_PADDING_WORLD,
        y: bounds.y - FOCUS_PADDING_WORLD,
        w: bounds.w + FOCUS_PADDING_WORLD * 2,
        h: bounds.h + FOCUS_PADDING_WORLD * 2,
      };
      moveTo(fitRect(padded, 0, opts?.zoom ?? FOCUS_MAX_ZOOM), 'focus', opts?.animate !== false);
    },

    reset(): void {
      moveTo(RESET_STATE, 'reset', true);
    },

    screenToWorld(p: Vec2): Vec2 {
      return screenToWorld(state, p);
    },

    worldToScreen(p: Vec2): Vec2 {
      return worldToScreen(state, p);
    },

    get viewportWorld(): Rect {
      return viewportWorldRect(state, width, height);
    },

    setViewportSize(nextWidth: number, nextHeight: number): void {
      width = Math.max(0, finite(nextWidth, width));
      height = Math.max(0, finite(nextHeight, height));
    },

    setState(next: Readonly<CameraState>, cause: CameraCause): void {
      cancelAnimation();
      commit(next, cause, MIN_ZOOM_FIT);
    },

    cancelAnimation,

    get isAnimating(): boolean {
      return animation !== null;
    },

    tickAnimation(now: number): boolean {
      const anim = animation;
      if (anim === null) return false;
      const elapsed = finite(now, anim.startedAt) - anim.startedAt;
      const t = ease(clamp(elapsed / CAMERA_ANIM_MS, 0, 1));
      const zoom = unitToZoom(anim.fromUnit + (anim.toUnit - anim.fromUnit) * t);
      const centre: Vec2 = {
        x: anim.fromCentre.x + (anim.toCentre.x - anim.fromCentre.x) * t,
        y: anim.fromCentre.y + (anim.toCentre.y - anim.fromCentre.y) * t,
      };
      const done = elapsed >= CAMERA_ANIM_MS;
      const cause = anim.cause;
      if (done) animation = null;
      commit(fromCentre(centre, zoom), cause, MIN_ZOOM_FIT);
      return !done;
    },

    clampToBounds(bounds: Rect): void {
      const margin = CAMERA_BOUNDS_MARGIN;
      const allowed: Rect = {
        x: bounds.x - margin,
        y: bounds.y - margin,
        w: bounds.w + margin * 2,
        h: bounds.h + margin * 2,
      };
      commit(
        {
          zoom: state.zoom,
          x: clampAxis(state.x, allowed.x, allowed.w, width / state.zoom),
          y: clampAxis(state.y, allowed.y, allowed.h, height / state.zoom),
        },
        'user',
        MIN_ZOOM_FIT,
      );
    },
  };

  return camera;
}

/** Keeps the viewport inside `[min, min+size]`; centres it when the viewport is the larger one. */
function clampAxis(value: number, min: number, size: number, viewportSize: number): number {
  if (viewportSize >= size) return min + (size - viewportSize) / 2;
  return clamp(value, min, min + size - viewportSize);
}
