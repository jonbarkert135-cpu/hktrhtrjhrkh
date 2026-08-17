import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/types';
import {
  VIEWPORT_KEY_PREFIX,
  VIEWPORT_MAX_AGE_MS,
  VIEWPORT_WRITE_THROTTLE_MS,
  createViewportStore,
  parseViewport,
  shouldRestore,
} from '../src/camera/persistence';
import type { PersistedViewport, ViewportStorage } from '../src/camera/persistence';

/** Manual clock with timers: nothing fires until a test advances time. */
function timerClock(start = 0) {
  let t = start;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  return {
    now: () => t,
    setTimer(cb: () => void, ms: number): number {
      const handle = nextHandle++;
      timers.set(handle, { at: t + ms, cb });
      return handle;
    },
    clearTimer(handle: number): void {
      timers.delete(handle);
    },
    advance(ms: number): void {
      t += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= t) {
          timers.delete(handle);
          timer.cb();
        }
      }
    },
    get pending(): number {
      return timers.size;
    },
  };
}

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  const writes: Array<{ key: string; value: string }> = [];
  const storage: ViewportStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
      writes.push({ key, value });
    },
  };
  return { storage, writes, map };
}

const record = (over: Partial<PersistedViewport> = {}): PersistedViewport => ({
  x: 10,
  y: 20,
  zoom: 1,
  savedAt: 1_000_000,
  v: 1,
  ...over,
});

const VIEWPORT = { width: 1000, height: 800 };
const BOUNDS: Rect = { x: 0, y: 0, w: 2000, h: 2000 };

describe('viewport store writes', () => {
  it('writes once per 400 ms window, with the latest camera (trailing throttle)', () => {
    const clock = timerClock(5_000);
    const { storage, writes } = memoryStorage();
    const store = createViewportStore(storage, clock);

    store.save('b1', { x: 1, y: 1, zoom: 1 });
    store.save('b1', { x: 2, y: 2, zoom: 1 });
    clock.advance(VIEWPORT_WRITE_THROTTLE_MS - 1);
    expect(writes).toHaveLength(0);

    store.save('b1', { x: 3, y: 4, zoom: 0.5 });
    clock.advance(1);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]?.value ?? '')).toEqual({
      x: 3,
      y: 4,
      zoom: 0.5,
      savedAt: 5_000 + VIEWPORT_WRITE_THROTTLE_MS,
      v: 1,
    });
    expect(writes[0]?.key).toBe(`${VIEWPORT_KEY_PREFIX}b1`);
  });

  it('starts a new window after the previous write', () => {
    const clock = timerClock();
    const { storage, writes } = memoryStorage();
    const store = createViewportStore(storage, clock);
    store.save('b1', { x: 1, y: 1, zoom: 1 });
    clock.advance(VIEWPORT_WRITE_THROTTLE_MS);
    store.save('b1', { x: 9, y: 9, zoom: 1 });
    clock.advance(VIEWPORT_WRITE_THROTTLE_MS);
    expect(writes).toHaveLength(2);
  });

  it('flush writes the pending camera immediately and clears the timer (pagehide)', () => {
    const clock = timerClock();
    const { storage, writes } = memoryStorage();
    const store = createViewportStore(storage, clock);
    store.save('b1', { x: 7, y: 8, zoom: 2 });
    store.flush();
    expect(writes).toHaveLength(1);
    expect(clock.pending).toBe(0);
    clock.advance(VIEWPORT_WRITE_THROTTLE_MS * 2);
    expect(writes).toHaveLength(1);
  });

  it('flush without a pending camera writes nothing', () => {
    const clock = timerClock();
    const { storage, writes } = memoryStorage();
    createViewportStore(storage, clock).flush();
    expect(writes).toHaveLength(0);
  });

  it('dispose drops the pending write and its timer', () => {
    const clock = timerClock();
    const { storage, writes } = memoryStorage();
    const store = createViewportStore(storage, clock);
    store.save('b1', { x: 1, y: 1, zoom: 1 });
    store.dispose();
    clock.advance(VIEWPORT_WRITE_THROTTLE_MS * 2);
    expect(writes).toHaveLength(0);
    expect(clock.pending).toBe(0);
    store.dispose();
  });

  it('swallows a storage quota failure', () => {
    const clock = timerClock();
    const store = createViewportStore(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
      clock,
    );
    store.save('b1', { x: 1, y: 1, zoom: 1 });
    expect(() => clock.advance(VIEWPORT_WRITE_THROTTLE_MS)).not.toThrow();
  });
});

describe('viewport store reads', () => {
  it('loads a valid record under the per-board key', () => {
    const clock = timerClock();
    const { storage } = memoryStorage({
      [`${VIEWPORT_KEY_PREFIX}b1`]: JSON.stringify(record({ x: 5 })),
    });
    expect(createViewportStore(storage, clock).load('b1')).toEqual(record({ x: 5 }));
    expect(createViewportStore(storage, clock).load('other')).toBeNull();
  });

  it('returns null when storage itself throws (privacy mode)', () => {
    const clock = timerClock();
    const store = createViewportStore(
      {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => undefined,
      },
      clock,
    );
    expect(store.load('b1')).toBeNull();
  });

  it('rejects malformed, wrong-version and non-finite records', () => {
    expect(parseViewport('not json')).toBeNull();
    expect(parseViewport('null')).toBeNull();
    expect(parseViewport('42')).toBeNull();
    expect(parseViewport(JSON.stringify({ ...record(), v: 2 }))).toBeNull();
    expect(parseViewport(JSON.stringify({ ...record(), x: '3' }))).toBeNull();
    expect(parseViewport(JSON.stringify({ ...record(), y: Number.NaN }))).toBeNull();
    expect(parseViewport(JSON.stringify({ ...record(), zoom: 0 }))).toBeNull();
    expect(parseViewport(JSON.stringify({ ...record(), savedAt: 'yesterday' }))).toBeNull();
    expect(parseViewport(JSON.stringify(record()))).toEqual(record());
  });
});

describe('restore decision', () => {
  const now = 1_000_000_000;

  it('restores a fresh viewport that still sees the scene', () => {
    expect(shouldRestore(record({ savedAt: now - 1000 }), BOUNDS, VIEWPORT, now)).toBe('restore');
  });

  it('fits all when the record is 30 days old or older', () => {
    expect(
      shouldRestore(record({ savedAt: now - VIEWPORT_MAX_AGE_MS }), BOUNDS, VIEWPORT, now),
    ).toBe('fit-all');
    expect(
      shouldRestore(record({ savedAt: now - VIEWPORT_MAX_AGE_MS + 1 }), BOUNDS, VIEWPORT, now),
    ).toBe('restore');
  });

  it('fits all when the stored viewport no longer intersects the scene', () => {
    const far = record({ x: 500_000, y: 500_000, savedAt: now });
    expect(shouldRestore(far, BOUNDS, VIEWPORT, now)).toBe('fit-all');
  });

  it('accounts for zoom when testing intersection', () => {
    // At zoom 0.05 the same camera origin sees 20,000 × 16,000 world px, which reaches the scene.
    const zoomedOut = record({ x: -5000, y: -5000, zoom: 0.05, savedAt: now });
    expect(shouldRestore(zoomedOut, BOUNDS, VIEWPORT, now)).toBe('restore');
    expect(shouldRestore({ ...zoomedOut, zoom: 4 }, BOUNDS, VIEWPORT, now)).toBe('fit-all');
  });

  it('fits all when nothing was persisted', () => {
    expect(shouldRestore(null, BOUNDS, VIEWPORT, now)).toBe('fit-all');
  });

  it('resets an empty board whatever was persisted', () => {
    expect(shouldRestore(record({ savedAt: now }), null, VIEWPORT, now)).toBe('reset');
    expect(shouldRestore(record({ savedAt: now }), { x: 0, y: 0, w: 0, h: 0 }, VIEWPORT, now)).toBe(
      'reset',
    );
  });
});
