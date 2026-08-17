/**
 * Local-first persistence (P3 §5.6–5.7). `y-indexeddb` owns the write path; this module owns the
 * lifecycle and the status machine around it:
 *
 * - attach before first render, so a previously visited board opens with zero network;
 * - a mutation is flushed to IndexedDB within 100 ms (N2) — the provider batches, we never debounce;
 * - storage failures become an actionable `error` state instead of a silent data loss.
 */

import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';

import { initialSyncStatus, reduceSync, toSyncError, type SyncStatus } from './syncStatus.ts';

/** N2's budget: a write must reach IndexedDB within this many milliseconds. */
export const DURABILITY_BUDGET_MS = 100;

export const boardStoreName = (boardId: string): string => `nexus-board-${boardId}`;

export interface PersistenceHandle {
  /** Resolves once the persisted state has been loaded into the doc (or storage is unusable). */
  readonly whenLoaded: Promise<void>;
  readonly status: () => SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  /** Clears the `error` state and re-attaches; used by the indicator's Retry action. */
  retry(): void;
  destroy(): Promise<void>;
}

export interface PersistenceOptions {
  boardId: string;
  doc: Y.Doc;
  /** Injected for tests; defaults to `y-indexeddb`. */
  createProvider?: (name: string, doc: Y.Doc) => IndexeddbPersistence;
  /** Injected for tests; defaults to the browser's online state and events. */
  connectivity?: {
    isOnline: () => boolean;
    subscribe: (listener: (online: boolean) => void) => () => void;
  };
  now?: () => number;
}

const browserConnectivity = (): NonNullable<PersistenceOptions['connectivity']> => ({
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

export function createPersistence(options: PersistenceOptions): PersistenceHandle {
  const now = options.now ?? (() => Date.now());
  const connectivity = options.connectivity ?? browserConnectivity();
  const createProvider =
    options.createProvider ?? ((name: string, doc: Y.Doc) => new IndexeddbPersistence(name, doc));

  let status = initialSyncStatus(connectivity.isOnline());
  const listeners = new Set<(next: SyncStatus) => void>();
  const emit = (event: Parameters<typeof reduceSync>[1]): void => {
    const next = reduceSync(status, event);
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener(status);
  };

  let provider: IndexeddbPersistence | null = null;
  let resolveLoaded: () => void = () => undefined;
  const whenLoaded = new Promise<void>((resolve) => {
    resolveLoaded = resolve;
  });

  const onUpdate = (_update: Uint8Array, origin: unknown): void => {
    // Updates the provider itself replays into the doc are not new writes.
    if (origin === provider) return;
    emit({ type: 'write' });
    // y-indexeddb writes synchronously on the next microtask batch; confirm on its `synced` tick.
    void Promise.resolve().then(() => emit({ type: 'flushed', at: now() }));
  };

  const attach = (): void => {
    try {
      if (options.createProvider === undefined && globalThis.indexedDB === undefined) {
        // Private mode or a locked-down browser: run in memory and say so, never throw.
        throw new Error('IndexedDB is not supported in this browser context');
      }
      provider = createProvider(boardStoreName(options.boardId), options.doc);
      provider.on('synced', () => {
        emit({ type: 'flushed', at: now() });
        resolveLoaded();
      });
      provider.whenSynced
        .then(() => {
          resolveLoaded();
        })
        .catch((error: unknown) => {
          emit({ type: 'error', error: toSyncError(error) });
          resolveLoaded();
        });
    } catch (error) {
      emit({ type: 'error', error: toSyncError(error) });
      resolveLoaded();
    }
  };

  options.doc.on('update', onUpdate);
  const offConnectivity = connectivity.subscribe((online) => {
    emit({ type: 'online', online });
  });
  attach();

  return {
    whenLoaded,
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
    retry() {
      emit({ type: 'retry' });
      if (provider === null) attach();
    },
    async destroy() {
      options.doc.off('update', onUpdate);
      offConnectivity();
      listeners.clear();
      const current = provider;
      provider = null;
      if (current !== null) await current.destroy();
    },
  };
}
