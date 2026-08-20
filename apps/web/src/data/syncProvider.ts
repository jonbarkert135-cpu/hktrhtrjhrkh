/**
 * The server sync provider (P8 §5/§6/§7/§14). Composes `y-indexeddb` (P3, `persistence.ts`) with
 * the Hocuspocus WebSocket provider: IndexedDB always loads first so the board renders before the
 * socket connects (§5), and the two report into one status the UI reads (`syncStatus.ts` for the
 * local half, `connectionState.ts` for the server half — see `serverSyncLabel` below).
 *
 * The real `@hocuspocus/provider` construction is behind `createProvider` so this module is
 * testable with a fake socket; wiring this into `BoardDocProvider` (`docProvider.tsx`) is left to
 * the integration step described in RAVEN-SPEC/20_ROADMAP.md P8's implementation-status note —
 * deferred here specifically to avoid touching board-loading code while P7 restructures the same
 * area on its own branch (phase/p07-projects-search).
 */

import type * as Y from 'yjs';

import {
  reconnectDelayMs,
  reduceConnection,
  type ConnectionEvent,
  type ConnectionState,
} from './connectionState.ts';

/** The minimal surface this module needs from `@hocuspocus/provider`'s `HocuspocusProvider`. */
export interface ProviderLike {
  on(event: 'open', cb: () => void): void;
  on(event: 'close', cb: (data: { event: { code: number; reason: string } }) => void): void;
  on(event: 'authenticationFailed', cb: (data: { reason: string }) => void): void;
  connect(): void;
  disconnect(): void;
  destroy(): void;
}

export interface CreateProviderArgs {
  url: string;
  boardId: string;
  doc: Y.Doc;
  /** Silent refresh (P8 §14): called on every (re)connect attempt so the token is always fresh. */
  token: () => Promise<string>;
}

export interface SyncProviderHandle {
  state: () => ConnectionState;
  subscribe(listener: (state: ConnectionState) => void): () => void;
  destroy(): void;
}

export interface SyncProviderOptions extends CreateProviderArgs {
  createProvider: (args: CreateProviderArgs) => ProviderLike;
  /** Injected for deterministic tests; defaults to real timers. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  random?: () => number;
  connectivity?: {
    isOnline: () => boolean;
    subscribe: (listener: (online: boolean) => void) => () => void;
  };
}

const browserConnectivity = (): NonNullable<SyncProviderOptions['connectivity']> => ({
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  subscribe: (listener) => {
    if (typeof window === 'undefined') return () => undefined;
    const online = () => listener(true);
    const offline = () => listener(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  },
});

/**
 * Creates and manages the server half of sync. IndexedDB is expected to already be attached by
 * the caller (`persistence.ts`) before this is constructed — this module only adds the socket.
 */
export function createSyncProvider(options: SyncProviderOptions): SyncProviderHandle {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const random = options.random ?? Math.random;
  const connectivity = options.connectivity ?? browserConnectivity();

  let state: ConnectionState = { kind: 'connecting' };
  const listeners = new Set<(s: ConnectionState) => void>();
  let reconnectTimer: unknown = null;
  let destroyed = false;

  const emit = (event: ConnectionEvent): void => {
    const next = reduceConnection(state, event);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener(state);
  };

  let provider: ProviderLike | null = null;

  const scheduleReconnect = (attempt: number): void => {
    if (destroyed) return;
    const delay = reconnectDelayMs(attempt, random);
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      provider?.connect();
    }, delay);
  };

  const attach = (): void => {
    provider = options.createProvider({
      url: options.url,
      boardId: options.boardId,
      doc: options.doc,
      token: options.token,
    });
    provider.on('open', () => {
      emit({ type: 'open' });
    });
    provider.on('close', ({ event }) => {
      emit({ type: 'close', code: event.code, reason: event.reason });
      if (event.code !== 4403) {
        // `state.attempt` was just incremented by `emit`; the delay uses the 0-indexed exponent
        // (attempt 1 -> 1s, attempt 2 -> 2s, …), so it is `attempt - 1`.
        const attempt = state.kind === 'reconnecting' ? state.attempt - 1 : 0;
        scheduleReconnect(attempt);
      }
    });
    provider.on('authenticationFailed', () => {
      emit({ type: 'error' });
    });
  };

  attach();

  const offConnectivity = connectivity.subscribe((online) => {
    emit({ type: online ? 'online' : 'offline' });
    if (online) provider?.connect();
  });

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    destroy() {
      destroyed = true;
      if (reconnectTimer !== null) clearTimer(reconnectTimer);
      offConnectivity();
      listeners.clear();
      provider?.destroy();
    },
  };
}

/** The six states P8 §6 mandates, layered on top of the local `SyncStatus` label. */
export function serverSyncLabel(
  connection: ConnectionState,
  localState: 'saving' | 'saved' | 'offline' | 'error',
): string {
  if (connection.kind === 'offline' || localState === 'offline') {
    return 'Offline';
  }
  if (connection.kind === 'read-only') return 'Read-only';
  if (connection.kind === 'reconnecting') {
    return connection.attempt >= 2
      ? `Reconnecting… attempt ${String(connection.attempt)}`
      : 'Reconnecting…';
  }
  if (connection.kind === 'closed') return 'Read-only';
  if (localState === 'error') return 'Error';
  if (connection.kind === 'connecting') return 'Saving…';
  return localState === 'saved' ? 'Saved' : 'Saving…';
}
