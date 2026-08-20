/**
 * Room eviction (P8 §5.12, 19_DEPLOYMENT.md §13): a room with zero connections for 60 s is
 * snapshotted and unloaded. Kept as plain scheduling logic, independent of Hocuspocus's timer API,
 * so it is unit-testable with fake timers (`apps/sync/test/eviction.test.ts`).
 */

export const IDLE_EVICTION_MS = 60_000;

export interface EvictionHooks {
  /** Persist the room's current state (snapshot + projection) before it is dropped from memory. */
  snapshotAndUnload(roomName: string): Promise<void>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Tracks connection counts per room and calls `snapshotAndUnload` once a room has been empty for
 * `IDLE_EVICTION_MS`. A reconnect within the window cancels the pending eviction — this is what
 * keeps a network blip from unloading a room a client is about to resume into (P8 §7).
 */
export class RoomEvictionTracker {
  private readonly timers = new Map<string, unknown>();
  private readonly connectionCounts = new Map<string, number>();
  private readonly hooks: Required<EvictionHooks>;

  constructor(hooks: EvictionHooks) {
    this.hooks = {
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      ...hooks,
    };
  }

  onConnect(roomName: string): void {
    const cancel = this.timers.get(roomName);
    if (cancel !== undefined) {
      this.hooks.clearTimer(cancel);
      this.timers.delete(roomName);
    }
    this.connectionCounts.set(roomName, (this.connectionCounts.get(roomName) ?? 0) + 1);
  }

  onDisconnect(roomName: string): void {
    const count = Math.max(0, (this.connectionCounts.get(roomName) ?? 1) - 1);
    this.connectionCounts.set(roomName, count);
    if (count > 0) return;

    const handle = this.hooks.setTimer(() => {
      this.timers.delete(roomName);
      void this.hooks.snapshotAndUnload(roomName);
    }, IDLE_EVICTION_MS);
    this.timers.set(roomName, handle);
  }

  /** For metrics/tests: is this room currently on the eviction clock. */
  isPendingEviction(roomName: string): boolean {
    return this.timers.has(roomName);
  }

  openRoomCount(): number {
    return [...this.connectionCounts.values()].filter((n) => n > 0).length;
  }

  /** Graceful shutdown (P8 §7): flush every room immediately instead of waiting out the timers. */
  async flushAll(roomNames: Iterable<string>): Promise<void> {
    for (const roomName of roomNames) {
      const handle = this.timers.get(roomName);
      if (handle !== undefined) this.hooks.clearTimer(handle);
      this.timers.delete(roomName);
      await this.hooks.snapshotAndUnload(roomName);
    }
  }
}
