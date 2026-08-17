/**
 * Injectable clock. Server time is the only truth (P1 edge case: client clock skew must never
 * affect session validity), so every timestamp written to the database comes from a Clock.
 */
export type Clock = {
  now(): Date;
  /** Epoch milliseconds — for durations and metrics, where allocating a Date is waste. */
  nowMs(): number;
};

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
};

/** Test clock. `advance` moves it forward; nothing moves it on its own. */
export function fixedClock(start: Date | number = 0): Clock & { advance(ms: number): void } {
  let ms = typeof start === 'number' ? start : start.getTime();
  if (!Number.isFinite(ms)) throw new RangeError('fixedClock: start must be a valid date');
  return {
    now: () => new Date(ms),
    nowMs: () => ms,
    advance(delta: number) {
      if (!Number.isFinite(delta) || delta < 0) {
        throw new RangeError('fixedClock.advance: delta must be a non-negative number of ms');
      }
      ms += delta;
    },
  };
}
