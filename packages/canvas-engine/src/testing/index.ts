/**
 * Headless test harness (18_TESTING.md §5): a manual clock, the recording render target, a pointer
 * script runner and a scene-snapshot helper. Importable as `@nexus/canvas-engine/testing`.
 *
 * Everything here is deterministic: no rAF, no timers, no DOM. Tests advance time by hand.
 */

import {
  createRecordingTarget,
  type DrawCall,
  type RecordingTarget,
} from '../render/recording-target';
import type { Engine } from '../engine';
import type { EngineClock, Vec2 } from '../types';
import type { Modifiers } from '../interaction/fsm';
import type { RawKey, RawPointer, RawWheel } from '../interaction/gestures';

export { createRecordingTarget, type DrawCall, type RecordingTarget };

/* --------------------------------------------------------------- clock */

export interface ManualClock extends EngineClock {
  /** Current time in ms. */
  readonly time: number;
  /** Advances time, firing every timer whose deadline passed, in deadline order. */
  advance(ms: number): void;
  /** Runs the pending frame callback (if any) at the current time. Returns true when it ran. */
  flushFrame(): boolean;
  readonly pendingFrames: number;
  readonly pendingTimers: number;
}

interface Timer {
  handle: number;
  at: number;
  cb: () => void;
}

export function createManualClock(start = 0): ManualClock {
  let time = start;
  let nextHandle = 1;
  const frames = new Map<number, (t: number) => void>();
  const timers: Timer[] = [];

  return {
    now: () => time,
    requestFrame(cb: (t: number) => void): number {
      const handle = nextHandle++;
      frames.set(handle, cb);
      return handle;
    },
    cancelFrame(handle: number): void {
      frames.delete(handle);
    },
    setTimer(cb: () => void, ms: number): number {
      const handle = nextHandle++;
      timers.push({ handle, at: time + ms, cb });
      return handle;
    },
    clearTimer(handle: number): void {
      const i = timers.findIndex((t) => t.handle === handle);
      if (i >= 0) timers.splice(i, 1);
    },
    get time(): number {
      return time;
    },
    advance(ms: number): void {
      const target = time + ms;
      for (;;) {
        const due = timers
          .filter((t) => t.at <= target)
          .sort((a, b) => a.at - b.at || a.handle - b.handle)[0];
        if (due === undefined) break;
        timers.splice(timers.indexOf(due), 1);
        time = due.at;
        due.cb();
      }
      time = target;
    },
    flushFrame(): boolean {
      const entry = [...frames.entries()][0];
      if (entry === undefined) return false;
      frames.delete(entry[0]);
      entry[1](time);
      return true;
    },
    get pendingFrames(): number {
      return frames.size;
    },
    get pendingTimers(): number {
      return timers.length;
    },
  };
}

/* -------------------------------------------------------------- pointers */

export const NO_MODS: Modifiers = { shift: false, alt: false, ctrl: false, meta: false };

export function mods(over: Partial<Modifiers> = {}): Modifiers {
  return { ...NO_MODS, ...over };
}

export function pointer(x: number, y: number, over: Partial<RawPointer> = {}): RawPointer {
  return {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    screen: { x, y },
    mods: NO_MODS,
    ...over,
  };
}

export function wheel(deltaY: number, at: Vec2, over: Partial<RawWheel> = {}): RawWheel {
  return {
    deltaX: 0,
    deltaY,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    screen: at,
    ...over,
  };
}

export function key(name: string, over: Partial<RawKey> = {}): RawKey {
  return { key: name, mods: NO_MODS, repeat: false, ...over };
}

/** One step of a scripted gesture (18_TESTING.md §5.3). */
export type PointerStep =
  | { t: 'down'; at: Vec2; mods?: Partial<Modifiers> }
  | { t: 'move'; at: Vec2; mods?: Partial<Modifiers> }
  | { t: 'up'; at: Vec2; mods?: Partial<Modifiers> }
  | { t: 'cancel' }
  | { t: 'key'; key: string; mods?: Partial<Modifiers> }
  | { t: 'wheel'; deltaY: number; at: Vec2; ctrl?: boolean }
  | { t: 'wait'; ms: number }
  | { t: 'frame' };

/**
 * Replays a gesture against a live engine. `clock` must be the same manual clock the engine was
 * built with, otherwise `wait`/`frame` steps do nothing.
 */
export function runPointerScript(
  engine: Engine,
  clock: ManualClock,
  steps: readonly PointerStep[],
): void {
  for (const step of steps) {
    switch (step.t) {
      case 'down':
        engine.input.pointerDown(pointer(step.at.x, step.at.y, { mods: mods(step.mods) }));
        break;
      case 'move':
        engine.input.pointerMove(pointer(step.at.x, step.at.y, { mods: mods(step.mods) }));
        break;
      case 'up':
        engine.input.pointerUp(pointer(step.at.x, step.at.y, { mods: mods(step.mods) }));
        break;
      case 'cancel':
        engine.input.pointerCancel(1);
        break;
      case 'key':
        engine.input.keyDown(key(step.key, { mods: mods(step.mods) }));
        engine.input.keyUp(key(step.key, { mods: mods(step.mods) }));
        break;
      case 'wheel':
        engine.input.wheel(wheel(step.deltaY, step.at, { ctrlKey: step.ctrl ?? false }));
        break;
      case 'wait':
        clock.advance(step.ms);
        break;
      case 'frame':
        engine.tick(clock.now());
        break;
      default:
        break;
    }
  }
}

/* -------------------------------------------------------------- snapshots */

/**
 * Stable text snapshot of everything painted since the last `reset()` (18_TESTING.md §5.4).
 * Delegates to the recording target so one formatter serves both unit and golden tests.
 */
export function sceneSnapshot(target: RecordingTarget): string {
  return target.toSnapshot();
}
