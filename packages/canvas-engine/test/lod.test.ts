import { describe, expect, it } from 'vitest';

import { LOD_HYSTERESIS, LOD_SETTLE_MS, LOD_THRESHOLDS, LOD_ZOOM_QUANTUM } from '../src/constants';
import type { PaintLod } from '../src/render/lod';
import { createLodController, paintLodFor, quantizeZoom, toLodLevel } from '../src/render/lod';
import type { EngineClock } from '../src/types';

/** Manual clock (18_TESTING.md §5.2): no timers, no sleeps, fully deterministic. */
function manualClock(): EngineClock & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  return {
    now: () => now,
    requestFrame: () => 0,
    cancelFrame: () => undefined,
    setTimer(cb: () => void, ms: number): number {
      const handle = next;
      next += 1;
      timers.set(handle, { at: now + ms, cb });
      return handle;
    },
    clearTimer(handle: number): void {
      timers.delete(handle);
    },
    advance(ms: number): void {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(handle);
          timer.cb();
        }
      }
    },
    pending: () => timers.size,
  };
}

describe('LOD ladder', () => {
  it('maps zoom to the four painting levels at the documented thresholds (P2 req 6)', () => {
    const cases: Array<[number, PaintLod]> = [
      [0.05, 'dot'],
      [LOD_THRESHOLDS.glyph - 0.001, 'dot'],
      [LOD_THRESHOLDS.glyph, 'glyph'],
      [0.3, 'glyph'],
      [LOD_THRESHOLDS.glyphWithText, 'glyphText'],
      [0.5, 'glyphText'],
      [LOD_THRESHOLDS.dom, 'dom'],
      [4, 'dom'],
    ];
    for (const [zoom, expected] of cases) expect(paintLodFor(zoom)).toBe(expected);
  });

  it('collapses to the frozen LodLevel the overlay uses', () => {
    expect(toLodLevel('dot')).toBe('dot');
    expect(toLodLevel('glyph')).toBe('glyph');
    expect(toLodLevel('glyphText')).toBe('glyph');
    expect(toLodLevel('dom')).toBe('dom');
  });

  it('holds the previous level inside the hysteresis dead-band (§6.8)', () => {
    const t = LOD_THRESHOLDS.dom;
    // Climbing: the band must be cleared upward.
    expect(paintLodFor(t, 'glyphText')).toBe('glyphText');
    expect(paintLodFor(t + LOD_HYSTERESIS, 'glyphText')).toBe('dom');
    // Falling: the band must be cleared downward.
    expect(paintLodFor(t - LOD_HYSTERESIS, 'dom')).toBe('dom');
    expect(paintLodFor(t - LOD_HYSTERESIS - 0.001, 'dom')).toBe('glyphText');
  });

  it('does not thrash across a boundary under a slow scrub', () => {
    const clock = manualClock();
    const lod = createLodController(clock);
    let level = lod.levelFor(0.7);
    let switches = 0;
    for (let i = 0; i < 200; i += 1) {
      const zoom = LOD_THRESHOLDS.dom + Math.sin(i / 3) * 0.015;
      const next = lod.levelFor(zoom);
      if (next !== level) switches += 1;
      level = next;
    }
    expect(switches).toBe(0); // the dead-band absorbs the whole scrub
    lod.dispose();
  });
});

describe('stable ("efficient") zoom', () => {
  it('quantizes to LOD_ZOOM_QUANTUM steps', () => {
    expect(quantizeZoom(0.549)).toBeCloseTo(0.5, 6);
    expect(quantizeZoom(0.55)).toBeCloseTo(0.55, 6);
    expect(quantizeZoom(1)).toBeCloseTo(1, 6);
  });

  it('uses the raw zoom while the camera is idle', () => {
    const clock = manualClock();
    const lod = createLodController(clock);
    lod.levelFor(0.632);
    expect(lod.quantized).toBe(false);
    expect(lod.stableZoom).toBeCloseTo(0.632, 6);
  });

  it('freezes on the quantized zoom during a gesture and releases LOD_SETTLE_MS later (req 7)', () => {
    const clock = manualClock();
    const lod = createLodController(clock);

    lod.cameraChanged();
    lod.levelFor(0.632);
    expect(lod.quantized).toBe(true);
    expect(lod.stableZoom).toBeCloseTo(0.6, 6);

    // A continuous gesture keeps refreshing the window: it never releases mid-gesture.
    for (let i = 0; i < 10; i += 1) {
      clock.advance(LOD_SETTLE_MS - 1);
      lod.cameraChanged();
      lod.levelFor(0.632 - i * 0.001);
      expect(lod.quantized).toBe(true);
    }

    clock.advance(LOD_SETTLE_MS);
    expect(clock.pending()).toBe(0);
    lod.levelFor(0.622);
    expect(lod.quantized).toBe(false);
    expect(lod.stableZoom).toBeCloseTo(0.622, 6);
  });

  it('suppresses promotion churn while zooming through a threshold', () => {
    const clock = manualClock();
    const lod = createLodController(clock);
    lod.levelFor(0.3);
    const seen: PaintLod[] = [];
    for (let i = 0; i < 70; i += 1) {
      lod.cameraChanged();
      // 0.30 → 0.645 in 0.005 increments: 70 frames, far finer than the quantum.
      seen.push(lod.levelFor(0.3 + i * 0.005));
      clock.advance(8);
    }
    const distinct = seen.filter((l, i) => i === 0 || l !== seen[i - 1]);
    expect(distinct).toEqual(['glyph', 'glyphText', 'dom']);
    expect(lod.stableZoom % LOD_ZOOM_QUANTUM).toBeLessThan(1e-9);
    lod.dispose();
    expect(clock.pending()).toBe(0);
  });

  it('exposes the coarse level and cleans its timer up on dispose', () => {
    const clock = manualClock();
    const lod = createLodController(clock);
    expect(lod.level(0.3)).toBe('glyph');
    expect(lod.level(1)).toBe('dom');
    lod.cameraChanged();
    expect(clock.pending()).toBe(1);
    lod.dispose();
    expect(clock.pending()).toBe(0);
    lod.dispose();
    expect(clock.pending()).toBe(0);
  });
});
