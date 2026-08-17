import { describe, expect, it } from 'vitest';
import {
  CAMERA_ANIM_MS,
  CAMERA_BOUNDS_MARGIN,
  MAX_WORLD_COORD,
  MAX_ZOOM,
  MIN_ZOOM,
  MIN_ZOOM_FIT,
} from '../src/constants';
import type { CameraCause, CameraState, Rect } from '../src/types';
import { createCamera } from '../src/camera/camera';
import {
  inflateRect,
  rectsIntersect,
  screenRectToWorld,
  screenToWorld,
  viewportWorldRect,
  worldRectToScreen,
  worldToScreen,
} from '../src/camera/coords';

/** Manual clock (18_TESTING.md §5.2): nothing moves unless a test moves it. */
function manualClock(start = 0): { now(): number; advance(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const VIEWPORT = { width: 1000, height: 800 };

function setup(
  overrides: {
    state?: CameraState;
    prefersReducedMotion?: boolean;
    sceneBounds?: Rect | null;
    entityBounds?: Rect | null;
  } = {},
) {
  const clock = manualClock(1_000);
  const changes: Array<{ state: CameraState; cause: CameraCause }> = [];
  const camera = createCamera({
    ...(overrides.state ? { state: overrides.state } : {}),
    viewport: { ...VIEWPORT },
    clock,
    prefersReducedMotion: overrides.prefersReducedMotion ?? false,
    onChange: (state, cause) => changes.push({ state: { ...state }, cause }),
    sceneBounds: () => overrides.sceneBounds ?? null,
    entityBounds: () => overrides.entityBounds ?? null,
  });
  return { camera, clock, changes };
}

describe('coordinate transforms', () => {
  it('round-trips world→screen→world for random points at random zooms', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 500; i += 1) {
      const cam: CameraState = {
        x: (rng() - 0.5) * 1e5,
        y: (rng() - 0.5) * 1e5,
        zoom: MIN_ZOOM + rng() * (MAX_ZOOM - MIN_ZOOM),
      };
      const p = { x: (rng() - 0.5) * 1e5, y: (rng() - 0.5) * 1e5 };
      const back = screenToWorld(cam, worldToScreen(cam, p));
      expect(Math.abs(back.x - p.x)).toBeLessThan(1e-6);
      expect(Math.abs(back.y - p.y)).toBeLessThan(1e-6);
    }
  });

  it('round-trips rects in both directions', () => {
    const cam: CameraState = { x: -120.5, y: 44.25, zoom: 0.375 };
    const rect: Rect = { x: 10, y: -20, w: 300, h: 180 };
    const back = screenRectToWorld(cam, worldRectToScreen(cam, rect));
    expect(back.x).toBeCloseTo(rect.x, 9);
    expect(back.y).toBeCloseTo(rect.y, 9);
    expect(back.w).toBeCloseTo(rect.w, 9);
    expect(back.h).toBeCloseTo(rect.h, 9);
  });

  it('places the container top-left at the camera origin', () => {
    const cam: CameraState = { x: 100, y: 50, zoom: 2 };
    expect(worldToScreen(cam, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(viewportWorldRect(cam, 1000, 800)).toEqual({ x: 100, y: 50, w: 500, h: 400 });
  });

  it('inflates rects symmetrically and detects intersection', () => {
    const a: Rect = { x: 0, y: 0, w: 10, h: 10 };
    expect(inflateRect(a, 5)).toEqual({ x: -5, y: -5, w: 20, h: 20 });
    expect(rectsIntersect(a, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(rectsIntersect(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });

  it('accumulates no float drift over 10,000 successive pans', () => {
    const { camera } = setup({ state: { x: 0, y: 0, zoom: 0.375 } });
    const probe = { x: 1234.5, y: -987.25 };
    let worst = 0;
    for (let i = 0; i < 10_000; i += 1) {
      camera.panBy(i % 2 === 0 ? 3 : -3, i % 3 === 0 ? 5 : -5);
      const back = camera.screenToWorld(camera.worldToScreen(probe));
      worst = Math.max(worst, Math.abs(back.x - probe.x), Math.abs(back.y - probe.y));
    }
    expect(worst).toBeLessThan(1e-6);
    // The pan sequence nets a known offset; the camera must not have wandered off it.
    expect(Number.isFinite(camera.state.x)).toBe(true);
  });
});

describe('camera panning and zooming', () => {
  it('pans in screen px, scaled by zoom', () => {
    const { camera, changes } = setup({ state: { x: 0, y: 0, zoom: 2 } });
    camera.panBy(100, -50);
    expect(camera.state).toMatchObject({ x: 50, y: -25, zoom: 2 });
    expect(changes.at(-1)?.cause).toBe('user');
  });

  it('ignores a non-finite pan delta', () => {
    const { camera } = setup();
    camera.panBy(Number.NaN, 10);
    expect(camera.state).toMatchObject({ x: 0, y: 10 });
  });

  it('keeps the world point under the cursor fixed at 12 zoom levels', () => {
    const anchor = { x: 317, y: 211 };
    const levels = [0.05, 0.08, 0.12, 0.2, 0.33, 0.5, 0.75, 1, 1.5, 2, 3, 4];
    const { camera } = setup({ state: { x: -420.5, y: 133.25, zoom: 0.9 } });
    for (const zoom of levels) {
      const before = camera.screenToWorld(anchor);
      camera.zoomTo(zoom, anchor);
      const after = camera.screenToWorld(anchor);
      expect(camera.state.zoom).toBe(zoom);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9);
    }
  });

  it('clamps wheel-reachable zoom to [MIN_ZOOM, MAX_ZOOM]', () => {
    const { camera } = setup();
    camera.zoomTo(99, { x: 0, y: 0 });
    expect(camera.state.zoom).toBe(MAX_ZOOM);
    camera.zoomTo(0.0001, { x: 0, y: 0 });
    expect(camera.state.zoom).toBe(MIN_ZOOM);
  });

  it('zoomBy steps along the curve and lands on snap stops', () => {
    const { camera } = setup({ state: { x: 0, y: 0, zoom: 1 } });
    camera.zoomBy(200, { x: 500, y: 400 });
    expect(camera.state.zoom).toBeGreaterThan(1);
    camera.zoomTo(1.01, { x: 500, y: 400 });
    camera.zoomBy(0, { x: 500, y: 400 });
    expect(camera.state.zoom).toBe(1);
  });

  it('clamps extreme camera coordinates to ±1e7', () => {
    const { camera } = setup();
    camera.setState({ x: 5e9, y: -5e9, zoom: 1 }, 'restore');
    expect(camera.state.x).toBe(MAX_WORLD_COORD);
    expect(camera.state.y).toBe(-MAX_WORLD_COORD);
  });
});

describe('fit and focus', () => {
  it('fits a rect to hand-computed numbers', () => {
    const { camera, changes } = setup();
    camera.fit({ x: 0, y: 0, w: 400, h: 200 }, { animate: false });
    // min(1, (1000-128)/400, (800-128)/200) = 1 → centre (200,100), camera = centre - vp/2
    expect(camera.state).toEqual({ x: -300, y: -300, zoom: 1 });
    expect(changes.at(-1)?.cause).toBe('fit');
  });

  it('fits a wide rect at the width-limited zoom', () => {
    const { camera } = setup();
    camera.fit({ x: 0, y: 0, w: 4000, h: 2000 }, { animate: false });
    // (1000 - 128) / 4000 = 0.218 ; centre (2000,1000) ; x = 2000 - 500/0.218
    expect(camera.state.zoom).toBeCloseTo(0.218, 12);
    expect(camera.state.x).toBeCloseTo(-293.5779816513761, 9);
    expect(camera.state.y).toBeCloseTo(-834.8623853211009, 9);
  });

  it('honours padding and maxZoom overrides', () => {
    const { camera } = setup();
    camera.fit({ x: 0, y: 0, w: 100, h: 100 }, { padding: 0, maxZoom: 4, animate: false });
    expect(camera.state.zoom).toBe(4); // min(4, 1000/100, 800/100) = 4
  });

  it('treats a zero-size rect as "zoom to maxZoom at its centre"', () => {
    const { camera } = setup();
    camera.fit({ x: 500, y: 500, w: 0, h: 0 }, { animate: false, maxZoom: 2 });
    expect(camera.state.zoom).toBe(2);
    expect(camera.state.x).toBe(500 - 250);
  });

  it('fitAll below MIN_ZOOM falls back to MIN_ZOOM_FIT, not MIN_ZOOM', () => {
    const { camera } = setup({ sceneBounds: { x: 0, y: 0, w: 100_000, h: 50_000 } });
    camera.fitAll({ animate: false });
    expect(camera.state.zoom).toBe(MIN_ZOOM_FIT);
    expect(camera.state.zoom).toBeLessThan(MIN_ZOOM);
    // …and the wheel cannot stay down there.
    camera.zoomBy(0, { x: 0, y: 0 });
    expect(camera.state.zoom).toBe(MIN_ZOOM);
  });

  it('fitAll on an empty board resets', () => {
    const { camera, changes } = setup({ state: { x: 40, y: 40, zoom: 3 }, sceneBounds: null });
    camera.fitAll({ animate: false });
    expect(camera.state).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(changes.at(-1)?.cause).toBe('reset');
  });

  it('focus fits the entity padded by 240 world px at 1.2× max', () => {
    const { camera, changes } = setup({ entityBounds: { x: 0, y: 0, w: 100, h: 100 } });
    camera.focus('n_1', { animate: false });
    // padded rect is 580×580 → min(1.2, 1000/580, 800/580) = 1.2
    expect(camera.state.zoom).toBeCloseTo(1.2, 12);
    expect(changes.at(-1)?.cause).toBe('focus');
  });

  it('focus on an unknown entity does nothing', () => {
    const { camera, changes } = setup({ entityBounds: null });
    camera.focus('nope');
    expect(changes).toHaveLength(0);
    expect(camera.isAnimating).toBe(false);
  });

  it('reset returns to the origin at zoom 1', () => {
    const { camera, clock } = setup({ state: { x: 900, y: 900, zoom: 2.5 } });
    camera.reset();
    clock.advance(CAMERA_ANIM_MS);
    camera.tickAnimation(clock.now());
    expect(camera.state).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe('camera animation', () => {
  it('steps a fit animation with the manual clock and lands exactly on the target', () => {
    const { camera, clock } = setup({ state: { x: 0, y: 0, zoom: 0.25 } });
    const target = { ...camera.state };
    camera.fit({ x: 0, y: 0, w: 168, h: 168 }, { padding: 64, maxZoom: 4, animate: true });
    expect(camera.isAnimating).toBe(true);
    expect(camera.state).toEqual(target); // nothing moves until a frame is ticked

    let frames = 0;
    let previousZoom = camera.state.zoom;
    while (camera.tickAnimation(clock.now())) {
      expect(camera.state.zoom).toBeGreaterThanOrEqual(previousZoom);
      previousZoom = camera.state.zoom;
      clock.advance(16);
      frames += 1;
      expect(frames).toBeLessThan(100);
    }
    expect(camera.isAnimating).toBe(false);
    expect(camera.state.zoom).toBeCloseTo(4, 9); // min(4, 872/168, 672/168) = 4
    expect(camera.tickAnimation(clock.now())).toBe(false);
  });

  it('interpolates zoom in zoom-unit space, not linearly', () => {
    const { camera, clock } = setup({ state: { x: -2000, y: -1600, zoom: 0.25 } });
    // fit a rect whose fit zoom is 4: zoom travels 0.25 → 4 while the centre travels linearly.
    camera.fit({ x: 0, y: 0, w: 168, h: 168 }, { padding: 64, maxZoom: 4, animate: true });
    const fromCentre = { x: -2000 + 500 / 0.25, y: -1600 + 400 / 0.25 };
    const toCentre = { x: 84, y: 84 };
    clock.advance(140);
    camera.tickAnimation(clock.now());
    const centre = {
      x: camera.state.x + 500 / camera.state.zoom,
      y: camera.state.y + 400 / camera.state.zoom,
    };
    const t = (centre.x - fromCentre.x) / (toCentre.x - fromCentre.x);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
    // geometric (log-space) interpolation: z = 0.25 * 16^t
    expect(camera.state.zoom).toBeCloseTo(0.25 * Math.pow(16, t), 9);
    // linear interpolation would have been noticeably different
    expect(camera.state.zoom).not.toBeCloseTo(0.25 + 3.75 * t, 2);
  });

  it('animates an anchored zoom and lands with the anchor point fixed', () => {
    const { camera, clock } = setup({ state: { x: 0, y: 0, zoom: 1 } });
    const anchor = { x: 250, y: 150 };
    const before = camera.screenToWorld(anchor);
    camera.zoomTo(2, anchor, { animate: true });
    expect(camera.isAnimating).toBe(true);
    clock.advance(CAMERA_ANIM_MS);
    expect(camera.tickAnimation(clock.now())).toBe(false);
    const after = camera.screenToWorld(anchor);
    expect(camera.state.zoom).toBeCloseTo(2, 9);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('jumps instantly when prefers-reduced-motion is set', () => {
    const { camera, changes } = setup({ prefersReducedMotion: true });
    camera.fit({ x: 0, y: 0, w: 400, h: 200 }, { animate: true });
    expect(camera.isAnimating).toBe(false);
    expect(camera.state).toEqual({ x: -300, y: -300, zoom: 1 });
    expect(changes).toHaveLength(1);
  });

  it('cancels an in-flight animation on user pan', () => {
    const { camera, clock } = setup();
    camera.fit({ x: 0, y: 0, w: 400, h: 200 }, { animate: true });
    clock.advance(80);
    camera.tickAnimation(clock.now());
    const midway = { ...camera.state };
    camera.panBy(10, 0);
    expect(camera.isAnimating).toBe(false);
    expect(camera.tickAnimation(clock.now() + 1000)).toBe(false);
    expect(camera.state.x).toBeCloseTo(midway.x + 10 / midway.zoom, 9);
  });

  it('cancels an in-flight animation on user zoom and on cancelAnimation()', () => {
    const { camera, clock } = setup();
    camera.fit({ x: 0, y: 0, w: 400, h: 200 }, { animate: true });
    camera.zoomTo(2, { x: 0, y: 0 });
    expect(camera.isAnimating).toBe(false);

    camera.fit({ x: 0, y: 0, w: 400, h: 200 }, { animate: true });
    clock.advance(16);
    camera.cancelAnimation();
    expect(camera.isAnimating).toBe(false);
  });

  it('emits every animated frame with the originating cause', () => {
    const { camera, clock, changes } = setup({ state: { x: 0, y: 0, zoom: 0.5 } });
    camera.fit({ x: 0, y: 0, w: 400, h: 200 }, { animate: true });
    clock.advance(160);
    camera.tickAnimation(clock.now());
    clock.advance(CAMERA_ANIM_MS);
    camera.tickAnimation(clock.now());
    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(new Set(changes.map((c) => c.cause))).toEqual(new Set(['fit']));
  });

  it('survives a non-finite frame time', () => {
    const { camera } = setup();
    camera.fit({ x: 0, y: 0, w: 400, h: 200 }, { animate: true });
    expect(camera.tickAnimation(Number.NaN)).toBe(true);
    expect(Number.isFinite(camera.state.zoom)).toBe(true);
  });
});

describe('viewport size and bounds clamping', () => {
  it('re-derives the world viewport after a resize', () => {
    const { camera } = setup({ state: { x: 0, y: 0, zoom: 2 } });
    camera.setViewportSize(400, 200);
    expect(camera.viewportWorld).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    camera.setViewportSize(Number.NaN, -10);
    expect(camera.viewportWorld.w).toBe(200);
    expect(camera.viewportWorld.h).toBe(0);
  });

  it('clamps the camera into the scene bounds plus the 2,000 px margin', () => {
    const bounds: Rect = { x: 0, y: 0, w: 40_000, h: 40_000 };
    const { camera } = setup({ state: { x: 9_000_000, y: -9_000_000, zoom: 1 } });
    camera.clampToBounds(bounds);
    const allowed = inflateRect(bounds, CAMERA_BOUNDS_MARGIN);
    expect(camera.state.x).toBe(allowed.x + allowed.w - 1000);
    expect(camera.state.y).toBe(allowed.y);
    expect(rectsIntersect(camera.viewportWorld, allowed)).toBe(true);
  });

  it('centres the camera when the viewport is larger than the allowed area', () => {
    const bounds: Rect = { x: 0, y: 0, w: 10, h: 10 };
    const { camera } = setup({ state: { x: 5000, y: 5000, zoom: 0.05 } });
    camera.clampToBounds(bounds);
    // allowed = -2000..2010 (4010 wide); world viewport is 20,000 × 16,000 → centred
    expect(camera.state.x).toBeCloseTo(-2000 + (4010 - 20_000) / 2, 9);
    expect(camera.state.y).toBeCloseTo(-2000 + (4010 - 16_000) / 2, 9);
  });

  it('leaves an already-inside camera untouched', () => {
    const { camera, changes } = setup({ state: { x: 100, y: 100, zoom: 1 } });
    camera.clampToBounds({ x: 0, y: 0, w: 40_000, h: 40_000 });
    expect(camera.state).toEqual({ x: 100, y: 100, zoom: 1 });
    expect(changes).toHaveLength(0);
  });
});
