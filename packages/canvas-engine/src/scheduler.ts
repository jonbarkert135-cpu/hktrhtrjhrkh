/**
 * Frame scheduling (20_ROADMAP P2 §5 req 15, 05_CANVAS_ENGINE.md §4).
 *
 * The engine never calls `requestAnimationFrame` itself: it asks the scheduler for a frame and the
 * scheduler coalesces any number of requests into **at most one** callback per frame. The time
 * source is the injected `EngineClock`, so the whole loop runs in Node against a manual clock.
 */

import type { EngineClock } from './types';

export interface Scheduler {
  /** Coalesced: many calls before the next frame produce exactly one callback. */
  request(): void;
  readonly pending: boolean;
  /**
   * Tab visibility (§8): while paused no frame is scheduled and the pending request is remembered,
   * so resuming paints once with the current time instead of replaying the missed frames.
   */
  setPaused(paused: boolean): void;
  readonly paused: boolean;
  dispose(): void;
}

export interface SchedulerOptions {
  clock: EngineClock;
  /** Painted frame. Exceptions are the caller's problem; the handle is released first. */
  onFrame: (now: number) => void;
}

export function createScheduler({ clock, onFrame }: SchedulerOptions): Scheduler {
  let handle: number | null = null;
  let wanted = false;
  let paused = false;
  let disposed = false;

  const run = (now: number): void => {
    handle = null;
    wanted = false;
    onFrame(now);
  };

  const schedule = (): void => {
    if (handle !== null || paused || disposed) return;
    handle = clock.requestFrame(run);
  };

  return {
    request(): void {
      if (disposed) return;
      wanted = true;
      schedule();
    },
    get pending(): boolean {
      return handle !== null || (wanted && paused);
    },
    setPaused(next: boolean): void {
      if (disposed || next === paused) return;
      paused = next;
      if (paused) {
        if (handle !== null) {
          clock.cancelFrame(handle);
          handle = null;
        }
        return;
      }
      if (wanted) schedule();
    },
    get paused(): boolean {
      return paused;
    },
    dispose(): void {
      disposed = true;
      wanted = false;
      if (handle !== null) {
        clock.cancelFrame(handle);
        handle = null;
      }
    },
  };
}
