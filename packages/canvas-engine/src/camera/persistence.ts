/**
 * Personal viewport persistence (05_CANVAS_ENGINE.md §5.7).
 *
 * The camera is personal UI state: it lives outside the Y.Doc and must never sync to
 * collaborators. This module never touches the `localStorage` global — the host injects a
 * `{ getItem, setItem }` pair, which is what keeps the engine free of browser globals
 * (00_MASTER.md §4, P2 requirement 9.3) and makes the throttle testable with a manual clock.
 */

import type { CameraState, EngineClock, Rect } from '../types';
import { rectsIntersect, viewportWorldRect } from './coords';

export const VIEWPORT_KEY_PREFIX = 'nexus.viewport.';
export const VIEWPORT_WRITE_THROTTLE_MS = 400;
export const VIEWPORT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface PersistedViewport {
  x: number;
  y: number;
  zoom: number;
  savedAt: number;
  v: 1;
}

/** The `localStorage`-shaped slice the store needs; the host may back it with anything. */
export interface ViewportStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** §5.7: restore a fresh, still-relevant viewport; fit the scene otherwise; reset an empty board. */
export type RestoreDecision = 'restore' | 'fit-all' | 'reset';

export interface ViewportStore {
  load(boardId: string): PersistedViewport | null;
  /** Throttled, trailing: at most one write per 400 ms, always ending with the latest camera. */
  save(boardId: string, camera: Readonly<CameraState>): void;
  /** Writes any pending camera immediately (the host calls this on `pagehide`). */
  flush(): void;
  /** Drops the pending write and its timer. */
  dispose(): void;
}

export function createViewportStore(
  storage: ViewportStorage,
  clock: Pick<EngineClock, 'now' | 'setTimer' | 'clearTimer'>,
): ViewportStore {
  let pending: { boardId: string; camera: CameraState } | null = null;
  let timer: number | null = null;

  const write = (): void => {
    const next = pending;
    pending = null;
    if (next === null) return;
    const record: PersistedViewport = {
      x: next.camera.x,
      y: next.camera.y,
      zoom: next.camera.zoom,
      savedAt: clock.now(),
      v: 1,
    };
    try {
      storage.setItem(VIEWPORT_KEY_PREFIX + next.boardId, JSON.stringify(record));
    } catch {
      // Quota exceeded or a storage-denied browser: a lost camera is not worth failing a board.
    }
  };

  return {
    load(boardId: string): PersistedViewport | null {
      let raw: string | null = null;
      try {
        raw = storage.getItem(VIEWPORT_KEY_PREFIX + boardId);
      } catch {
        return null;
      }
      return raw === null ? null : parseViewport(raw);
    },

    save(boardId: string, camera: Readonly<CameraState>): void {
      pending = { boardId, camera: { x: camera.x, y: camera.y, zoom: camera.zoom } };
      if (timer !== null) return;
      timer = clock.setTimer(() => {
        timer = null;
        write();
      }, VIEWPORT_WRITE_THROTTLE_MS);
    },

    flush(): void {
      if (timer !== null) {
        clock.clearTimer(timer);
        timer = null;
      }
      write();
    },

    dispose(): void {
      if (timer !== null) clock.clearTimer(timer);
      timer = null;
      pending = null;
    },
  };
}

/** Storage is user-writable, so every field is validated before it can reach the camera. */
export function parseViewport(raw: string): PersistedViewport | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  // Spread, not a cast: reads unknown fields off untrusted JSON without asserting a shape.
  const record: Record<string, unknown> = { ...value };
  if (record['v'] !== 1) return null;
  const { x, y, zoom, savedAt } = record;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof zoom !== 'number' ||
    typeof savedAt !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(savedAt) ||
    !(zoom > 0) ||
    !Number.isFinite(zoom)
  ) {
    return null;
  }
  return { x, y, zoom, savedAt, v: 1 };
}

/**
 * §5.7: restore when the record is younger than 30 days *and* its viewport still intersects the
 * scene; an empty board (no bounds) resets; anything else fits the scene.
 */
export function shouldRestore(
  persisted: PersistedViewport | null,
  sceneBounds: Rect | null,
  viewport: { width: number; height: number },
  now: number,
): RestoreDecision {
  if (sceneBounds === null || sceneBounds.w <= 0 || sceneBounds.h <= 0) return 'reset';
  if (persisted === null) return 'fit-all';
  if (now - persisted.savedAt >= VIEWPORT_MAX_AGE_MS) return 'fit-all';
  const world = viewportWorldRect(persisted, viewport.width, viewport.height);
  return rectsIntersect(world, sceneBounds) ? 'restore' : 'fit-all';
}
