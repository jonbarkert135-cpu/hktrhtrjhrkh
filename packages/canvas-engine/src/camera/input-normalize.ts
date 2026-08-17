/**
 * Wheel / trackpad / pinch normalization (05_CANVAS_ENGINE.md §5.5).
 *
 * Browsers disagree on wheel units, and the same event means "pan" on a trackpad and "zoom" on a
 * mouse. This module turns a `WheelEvent`-shaped record into pixels plus an intent; it reads no
 * globals, so it runs in Node against plain object literals.
 */

import type { EngineClock } from '../types';
import { clamp } from './zoom-curve';

/** The subset of `WheelEvent` the engine reads. Keeps the module DOM-free and testable. */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  /** 0 = px, 1 = line, 2 = page. */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey?: boolean;
}

export interface NormalizedWheel {
  dx: number;
  dy: number;
  zoomIntent: boolean;
}

/** `canvas.wheelDefault` setting: what an unmodified wheel does (§5.5). */
export type WheelDefault = 'auto' | 'zoom' | 'pan';

export type PointerKind = 'mouse' | 'trackpad';

export interface NormalizeOptions {
  wheelDefault?: WheelDefault;
  /** Only consulted when `wheelDefault` is 'auto'; supply it from `createPointerKindDetector`. */
  pointerKind?: PointerKind;
}

/** DOM_DELTA_LINE → px, using the 16 px line height §5.5 fixes for all browsers. */
const LINE_PX = 16;
const PAGE_PX = 400;
const PINCH_CLAMP = 48;
const PAN_CLAMP = 240;

/** Below this magnitude a wheel tick is trackpad-shaped, per §5.5. */
const TRACKPAD_MAX_DELTA = 12;
export const POINTER_KIND_LATCH_MS = 700;

export function normalizeWheel(e: WheelLike, options: NormalizeOptions = {}): NormalizedWheel {
  const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
  let dx = e.deltaX * scale;
  let dy = e.deltaY * scale;

  // Pinch on macOS/Windows trackpads arrives as ctrlKey+wheel with small deltas.
  const pinch = e.ctrlKey || e.metaKey;
  if (pinch) {
    // §5.5 clamps only dy here: a pinch consumer zooms from dy and ignores dx.
    dy = clamp(dy, -PINCH_CLAMP, PINCH_CLAMP);
  } else {
    dx = clamp(dx, -PAN_CLAMP, PAN_CLAMP);
    dy = clamp(dy, -PAN_CLAMP, PAN_CLAMP);
    // Wheel + Shift is horizontal pan; mice report it on deltaY (§5.5 behaviour table).
    if (e.shiftKey === true && dx === 0) {
      dx = dy;
      dy = 0;
    }
  }

  return { dx, dy, zoomIntent: pinch || unmodifiedIntent(options) === 'zoom' };
}

function unmodifiedIntent(options: NormalizeOptions): 'zoom' | 'pan' {
  const wheelDefault = options.wheelDefault ?? 'auto';
  if (wheelDefault !== 'auto') return wheelDefault;
  // Mouse-wheel users expect zoom on a canvas; trackpad two-finger scroll is a pan.
  return (options.pointerKind ?? 'mouse') === 'mouse' ? 'zoom' : 'pan';
}

export interface PointerKindDetector {
  /** Classifies one wheel event and updates the latch. */
  classify(e: WheelLike): PointerKind;
  readonly kind: PointerKind;
}

/**
 * Mouse-vs-trackpad latch (§5.5): a wheel event is trackpad when `deltaY` is non-integral or
 * `|deltaY| < 12`, latched for 700 ms so one accidental round delta mid-flick does not flip the
 * default. The clock is injected, so tests drive the latch by hand.
 */
export function createPointerKindDetector(clock: Pick<EngineClock, 'now'>): PointerKindDetector {
  let kind: PointerKind = 'mouse';
  let latchedUntil = -Infinity;

  return {
    classify(e: WheelLike): PointerKind {
      const now = clock.now();
      // Line/page deltas only ever come from a classic wheel.
      const trackpad =
        e.deltaMode === 0 &&
        (!Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < TRACKPAD_MAX_DELTA);
      if (trackpad) {
        kind = 'trackpad';
        latchedUntil = now + POINTER_KIND_LATCH_MS;
      } else if (now >= latchedUntil) {
        kind = 'mouse';
        latchedUntil = -Infinity;
      }
      return kind;
    },
    get kind(): PointerKind {
      return kind;
    },
  };
}
