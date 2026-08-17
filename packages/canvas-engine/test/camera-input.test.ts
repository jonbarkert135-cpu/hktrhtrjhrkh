import { describe, expect, it } from 'vitest';
import { MAX_DPR } from '../src/constants';
import { resolveDpr } from '../src/camera/coords';
import {
  POINTER_KIND_LATCH_MS,
  createPointerKindDetector,
  normalizeWheel,
} from '../src/camera/input-normalize';
import type { WheelLike } from '../src/camera/input-normalize';

const wheel = (over: Partial<WheelLike> = {}): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

function manualClock(start = 0): { now(): number; advance(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe('wheel normalization', () => {
  it('passes pixel deltas through unchanged (DOM_DELTA_PIXEL)', () => {
    expect(normalizeWheel(wheel({ deltaX: -30, deltaY: 42 }), { wheelDefault: 'pan' })).toEqual({
      dx: -30,
      dy: 42,
      zoomIntent: false,
    });
  });

  it('converts line deltas at 16 px per line (DOM_DELTA_LINE)', () => {
    const r = normalizeWheel(wheel({ deltaY: 3, deltaX: -1, deltaMode: 1 }), {
      wheelDefault: 'pan',
    });
    expect(r).toEqual({ dx: -16, dy: 48, zoomIntent: false });
  });

  it('converts page deltas at 400 px per page (DOM_DELTA_PAGE)', () => {
    const r = normalizeWheel(wheel({ deltaY: 1, deltaMode: 2 }), { wheelDefault: 'pan' });
    expect(r.dy).toBe(240); // 400 px, then clamped by the ±240 pan guard
  });

  it('clamps pan spikes to ±240 px on both axes', () => {
    const r = normalizeWheel(wheel({ deltaX: -5000, deltaY: 5000 }), { wheelDefault: 'pan' });
    expect(r).toEqual({ dx: -240, dy: 240, zoomIntent: false });
  });

  it('treats ctrl+wheel as pinch zoom and clamps it to ±48 px', () => {
    const r = normalizeWheel(wheel({ deltaY: 120, ctrlKey: true }));
    expect(r.zoomIntent).toBe(true);
    expect(r.dy).toBe(48);
    expect(normalizeWheel(wheel({ deltaY: -120, ctrlKey: true })).dy).toBe(-48);
  });

  it('treats meta+wheel as zoom too', () => {
    expect(normalizeWheel(wheel({ deltaY: 4, metaKey: true })).zoomIntent).toBe(true);
  });

  it('turns shift+wheel into a horizontal pan', () => {
    const r = normalizeWheel(wheel({ deltaY: 60, shiftKey: true }), { wheelDefault: 'pan' });
    expect(r).toEqual({ dx: 60, dy: 0, zoomIntent: false });
  });

  it('keeps an explicit horizontal delta when shift is held', () => {
    const r = normalizeWheel(wheel({ deltaX: 12, deltaY: 60, shiftKey: true }), {
      wheelDefault: 'pan',
    });
    expect(r).toEqual({ dx: 12, dy: 60, zoomIntent: false });
  });

  it('applies the wheelDefault setting to unmodified wheels', () => {
    expect(normalizeWheel(wheel({ deltaY: 100 }), { wheelDefault: 'zoom' }).zoomIntent).toBe(true);
    expect(normalizeWheel(wheel({ deltaY: 100 }), { wheelDefault: 'pan' }).zoomIntent).toBe(false);
  });

  it("resolves 'auto' from the detected pointer kind", () => {
    expect(
      normalizeWheel(wheel({ deltaY: 100 }), { wheelDefault: 'auto', pointerKind: 'mouse' })
        .zoomIntent,
    ).toBe(true);
    expect(
      normalizeWheel(wheel({ deltaY: 4.5 }), { wheelDefault: 'auto', pointerKind: 'trackpad' })
        .zoomIntent,
    ).toBe(false);
    // no options at all: the mouse default from the §5.5 behaviour table
    expect(normalizeWheel(wheel({ deltaY: 100 })).zoomIntent).toBe(true);
  });
});

describe('mouse vs trackpad detection', () => {
  it('classifies a non-integral delta as trackpad', () => {
    const detector = createPointerKindDetector(manualClock());
    expect(detector.classify(wheel({ deltaY: 3.5 }))).toBe('trackpad');
    expect(detector.kind).toBe('trackpad');
  });

  it('classifies a small delta as trackpad and a big integral one as mouse', () => {
    const detector = createPointerKindDetector(manualClock());
    expect(detector.classify(wheel({ deltaY: 4 }))).toBe('trackpad');
    const fresh = createPointerKindDetector(manualClock());
    expect(fresh.classify(wheel({ deltaY: 120 }))).toBe('mouse');
  });

  it('latches trackpad for 700 ms across integral deltas', () => {
    const clock = manualClock(10_000);
    const detector = createPointerKindDetector(clock);
    detector.classify(wheel({ deltaY: 2.25 }));
    clock.advance(POINTER_KIND_LATCH_MS - 1);
    expect(detector.classify(wheel({ deltaY: 120 }))).toBe('trackpad');
    clock.advance(1);
    expect(detector.classify(wheel({ deltaY: 120 }))).toBe('mouse');
  });

  it('never classifies line or page deltas as trackpad', () => {
    const detector = createPointerKindDetector(manualClock());
    expect(detector.classify(wheel({ deltaY: 0.5, deltaMode: 1 }))).toBe('mouse');
    expect(detector.classify(wheel({ deltaY: 1, deltaMode: 2 }))).toBe('mouse');
  });

  it('feeds the wheelDefault:auto decision end to end', () => {
    const clock = manualClock();
    const detector = createPointerKindDetector(clock);
    const event = wheel({ deltaY: 6.75 });
    const r = normalizeWheel(event, {
      wheelDefault: 'auto',
      pointerKind: detector.classify(event),
    });
    expect(r).toEqual({ dx: 0, dy: 6.75, zoomIntent: false });
  });
});

describe('device pixel ratio', () => {
  it('caps the backing-store scale at MAX_DPR', () => {
    expect(resolveDpr(3)).toBe(MAX_DPR);
    expect(resolveDpr(1.5)).toBe(1.5);
    expect(resolveDpr(1)).toBe(1);
  });

  it('falls back to 1 for missing or nonsense ratios', () => {
    expect(resolveDpr(undefined)).toBe(1);
    expect(resolveDpr(Number.NaN)).toBe(1);
    expect(resolveDpr(0)).toBe(1);
    expect(resolveDpr(-2)).toBe(1);
  });
});
