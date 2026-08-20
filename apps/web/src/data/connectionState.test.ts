import { describe, expect, it } from 'vitest';

import {
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  reconnectDelayMs,
  reconnectLabel,
  reduceConnection,
  type ConnectionState,
} from './connectionState';

describe('reconnectDelayMs', () => {
  it('grows exponentially from 1s and caps at 30s', () => {
    expect(reconnectDelayMs(0, () => 1)).toBe(RECONNECT_MIN_MS);
    expect(reconnectDelayMs(1, () => 1)).toBe(2_000);
    expect(reconnectDelayMs(2, () => 1)).toBe(4_000);
    expect(reconnectDelayMs(10, () => 1)).toBe(RECONNECT_MAX_MS);
  });

  it('applies full jitter between 0 and the capped delay', () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(0);
    expect(reconnectDelayMs(0, () => 0.5)).toBe(500);
  });
});

describe('reduceConnection', () => {
  it('goes connecting -> connected on open', () => {
    expect(reduceConnection({ kind: 'connecting' }, { type: 'open' })).toEqual({
      kind: 'connected',
    });
  });

  it('a close bumps the reconnect attempt counter', () => {
    let state: ConnectionState = { kind: 'connected' };
    state = reduceConnection(state, { type: 'close', code: 1001, reason: 'restart' });
    expect(state).toEqual({ kind: 'reconnecting', attempt: 1 });
    state = reduceConnection(state, { type: 'error' });
    expect(state).toEqual({ kind: 'reconnecting', attempt: 2 });
  });

  it('a 4403 close (revoked membership) is terminal, not retried', () => {
    const state = reduceConnection(
      { kind: 'connected' },
      { type: 'close', code: 4403, reason: 'revoked' },
    );
    expect(state).toEqual({ kind: 'closed', code: 4403, reason: 'revoked' });
  });

  it('going offline overrides everything, and online resumes as connecting', () => {
    const offline = reduceConnection({ kind: 'connected' }, { type: 'offline' });
    expect(offline).toEqual({ kind: 'offline' });
    expect(reduceConnection(offline, { type: 'online' })).toEqual({ kind: 'connecting' });
  });

  it('read-only toggles independently of the connection lifecycle', () => {
    const readOnly = reduceConnection({ kind: 'connected' }, { type: 'read-only', readOnly: true });
    expect(readOnly).toEqual({ kind: 'read-only' });
    expect(reduceConnection(readOnly, { type: 'read-only', readOnly: false })).toEqual({
      kind: 'connected',
    });
  });
});

describe('reconnectLabel', () => {
  it('is null until the second failed attempt (P8 §7)', () => {
    expect(reconnectLabel({ kind: 'reconnecting', attempt: 1 })).toBeNull();
    expect(reconnectLabel({ kind: 'reconnecting', attempt: 2 })).toBe('Reconnecting… attempt 2');
  });

  it('is null outside the reconnecting state', () => {
    expect(reconnectLabel({ kind: 'connected' })).toBeNull();
  });
});
