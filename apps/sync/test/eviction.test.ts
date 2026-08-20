/**
 * P8 §11: `apps/sync/test/eviction.test.ts` — a room idle for 60 s is snapshotted and unloaded;
 * memory is released (19_DEPLOYMENT.md §13).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDLE_EVICTION_MS, RoomEvictionTracker } from '../src/eviction.ts';

describe('RoomEvictionTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('evicts a room 60s after its last connection drops', async () => {
    const snapshotAndUnload = vi.fn().mockResolvedValue(undefined);
    const tracker = new RoomEvictionTracker({ snapshotAndUnload });

    tracker.onConnect('board:b1');
    tracker.onDisconnect('board:b1');
    expect(tracker.isPendingEviction('board:b1')).toBe(true);
    expect(snapshotAndUnload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(IDLE_EVICTION_MS - 1);
    expect(snapshotAndUnload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(snapshotAndUnload).toHaveBeenCalledWith('board:b1');
  });

  it('a reconnect within the window cancels the pending eviction', async () => {
    const snapshotAndUnload = vi.fn().mockResolvedValue(undefined);
    const tracker = new RoomEvictionTracker({ snapshotAndUnload });

    tracker.onConnect('board:b1');
    tracker.onDisconnect('board:b1');
    await vi.advanceTimersByTimeAsync(IDLE_EVICTION_MS / 2);

    tracker.onConnect('board:b1'); // a client reconnects before the 60s elapse
    await vi.advanceTimersByTimeAsync(IDLE_EVICTION_MS);
    expect(snapshotAndUnload).not.toHaveBeenCalled();
    expect(tracker.isPendingEviction('board:b1')).toBe(false);
  });

  it('a room with two clients is not evicted until both disconnect', async () => {
    const snapshotAndUnload = vi.fn().mockResolvedValue(undefined);
    const tracker = new RoomEvictionTracker({ snapshotAndUnload });

    tracker.onConnect('board:b1');
    tracker.onConnect('board:b1');
    tracker.onDisconnect('board:b1');
    await vi.advanceTimersByTimeAsync(IDLE_EVICTION_MS);
    expect(snapshotAndUnload).not.toHaveBeenCalled();

    tracker.onDisconnect('board:b1');
    await vi.advanceTimersByTimeAsync(IDLE_EVICTION_MS);
    expect(snapshotAndUnload).toHaveBeenCalledTimes(1);
  });

  it('openRoomCount reflects only rooms with at least one connection', () => {
    const tracker = new RoomEvictionTracker({
      snapshotAndUnload: vi.fn().mockResolvedValue(undefined),
    });
    tracker.onConnect('board:b1');
    tracker.onConnect('board:b2');
    tracker.onDisconnect('board:b2');
    expect(tracker.openRoomCount()).toBe(1);
  });

  it('flushAll snapshots every room immediately, ignoring pending timers (graceful shutdown)', async () => {
    const snapshotAndUnload = vi.fn().mockResolvedValue(undefined);
    const tracker = new RoomEvictionTracker({ snapshotAndUnload });
    tracker.onConnect('board:b1');
    tracker.onDisconnect('board:b1');

    await tracker.flushAll(['board:b1']);
    expect(snapshotAndUnload).toHaveBeenCalledWith('board:b1');
    expect(tracker.isPendingEviction('board:b1')).toBe(false);
  });
});
