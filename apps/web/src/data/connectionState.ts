/**
 * Reconnection backoff and the server-side connection state machine (P8 §5.7, §6). Pure and
 * deterministic so `apps/web/src/data/syncProvider.ts` and its tests can drive it without a real
 * socket.
 */

export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

/** Exponential backoff 1s → 30s with jitter (P8 §7). `random` is injected for deterministic tests. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = RECONNECT_MIN_MS * 2 ** Math.max(0, attempt);
  const capped = Math.min(RECONNECT_MAX_MS, exponential);
  // Full jitter: uniformly between 0 and the capped delay, so a fleet of clients disconnected by
  // the same event does not reconnect in lockstep (P8 edge case §8, "network flapping").
  return Math.round(random() * capped);
}

export type ConnectionState =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting'; attempt: number }
  | { kind: 'offline' }
  | { kind: 'read-only' }
  | { kind: 'closed'; code: number; reason: string };

export type ConnectionEvent =
  | { type: 'open' }
  | { type: 'close'; code: number; reason: string }
  | { type: 'error' }
  | { type: 'offline' }
  | { type: 'online' }
  | { type: 'read-only'; readOnly: boolean };

/** A revoked-membership close (P8 §14) is terminal — the client must not keep retrying it. */
const TERMINAL_CLOSE_CODES = new Set([4403]);

export function reduceConnection(state: ConnectionState, event: ConnectionEvent): ConnectionState {
  switch (event.type) {
    case 'open':
      return { kind: 'connected' };
    case 'offline':
      return { kind: 'offline' };
    case 'online':
      return state.kind === 'offline' ? { kind: 'connecting' } : state;
    case 'read-only':
      return event.readOnly
        ? { kind: 'read-only' }
        : state.kind === 'read-only'
          ? { kind: 'connected' }
          : state;
    case 'error':
      return state.kind === 'reconnecting'
        ? { kind: 'reconnecting', attempt: state.attempt + 1 }
        : { kind: 'reconnecting', attempt: 1 };
    case 'close':
      if (TERMINAL_CLOSE_CODES.has(event.code))
        return { kind: 'closed', code: event.code, reason: event.reason };
      return state.kind === 'reconnecting'
        ? { kind: 'reconnecting', attempt: state.attempt + 1 }
        : { kind: 'reconnecting', attempt: 1 };
    default:
      return state;
  }
}

/** "Reconnecting… attempt N" only appears after the second failure (P8 §7). */
export function reconnectLabel(state: ConnectionState): string | null {
  if (state.kind !== 'reconnecting' || state.attempt < 2) return null;
  return `Reconnecting… attempt ${String(state.attempt)}`;
}
