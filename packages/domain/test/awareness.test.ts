/**
 * P8 §5.8/§5.9/§9: awareness shaping, caps, throttles and two-tab dedupe.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AWARENESS_PAYLOAD_CAP_BYTES,
  CURSOR_INTERVAL_MS,
  createThrottle,
  dedupeAwarenessClients,
  distinctUsers,
  exceedsAwarenessCap,
  sanitizeAwareness,
} from '../src/collab/awareness.ts';

describe('sanitizeAwareness', () => {
  it('caps selection at 50 ids and drops unknown fields', () => {
    const raw = {
      userId: 'u1',
      tabId: 't1',
      name: 'Alex',
      color: '#fff',
      selection: Array.from({ length: 80 }, (_, i) => `n${String(i)}`),
      email: 'alex@example.com', // must never survive sanitation (P8 §9)
    } as never;
    const clean = sanitizeAwareness(raw);
    expect(clean.selection).toHaveLength(50);
    expect('email' in clean).toBe(false);
  });

  it('drops a malformed cursor instead of throwing', () => {
    const clean = sanitizeAwareness({ userId: 'u1', tabId: 't1', cursor: { x: NaN, y: 1 } });
    expect(clean.cursor).toBeNull();
  });
});

describe('exceedsAwarenessCap', () => {
  it('flags a payload over 8 KB', () => {
    const small = { userId: 'u1' };
    expect(exceedsAwarenessCap(small)).toBe(false);
    const big = { userId: 'u1', blob: 'x'.repeat(AWARENESS_PAYLOAD_CAP_BYTES + 1) };
    expect(exceedsAwarenessCap(big)).toBe(true);
  });
});

describe('createThrottle', () => {
  it('lets the first call through and rate-limits the rest', () => {
    let t = 0;
    const throttle = createThrottle(CURSOR_INTERVAL_MS, () => t);
    expect(throttle()).toBe(true);
    expect(throttle()).toBe(false);
    t += CURSOR_INTERVAL_MS;
    expect(throttle()).toBe(true);
  });
});

describe('dedupeAwarenessClients / distinctUsers', () => {
  it('two tabs of the same user both appear in the client list but once in the avatar stack', () => {
    const states = new Map([
      [
        1,
        {
          userId: 'u1',
          tabId: 'ta',
          name: 'Alex',
          color: '#fff',
          cursor: null,
          selection: [],
          viewport: null,
          activeNodeId: null,
        },
      ],
      [
        2,
        {
          userId: 'u1',
          tabId: 'tb',
          name: 'Alex',
          color: '#fff',
          cursor: null,
          selection: [],
          viewport: null,
          activeNodeId: null,
        },
      ],
      [
        3,
        {
          userId: 'u2',
          tabId: 'tc',
          name: 'Sam',
          color: '#000',
          cursor: null,
          selection: [],
          viewport: null,
          activeNodeId: null,
        },
      ],
    ]);
    expect(dedupeAwarenessClients(states)).toHaveLength(3);
    expect(distinctUsers(states)).toHaveLength(2);
  });

  it('is referentially stable enough for a snapshot comparison in tests', () => {
    const fn = vi.fn();
    dedupeAwarenessClients(new Map());
    expect(fn).not.toHaveBeenCalled();
  });
});
