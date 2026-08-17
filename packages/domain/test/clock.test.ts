import { describe, expect, it } from 'vitest';
import { fixedClock, systemClock } from '../src/clock';

describe('clock', () => {
  it('fixedClock only moves when advanced', () => {
    const clock = fixedClock(new Date('2026-01-01T00:00:00.000Z'));
    const first = clock.now().toISOString();
    expect(clock.now().toISOString()).toBe(first);
    clock.advance(1000);
    expect(clock.nowMs() - new Date(first).getTime()).toBe(1000);
    expect(() => clock.advance(-1)).toThrow(RangeError);
  });

  it('rejects a start that is not a real time and accepts epoch ms', () => {
    expect(fixedClock(1_000).nowMs()).toBe(1_000);
    expect(() => fixedClock(new Date('not a date'))).toThrow(RangeError);
  });

  it('systemClock is non-decreasing', () => {
    expect(systemClock.nowMs()).toBeLessThanOrEqual(systemClock.now().getTime() + 5);
  });
});
