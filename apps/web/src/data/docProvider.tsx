/**
 * The board document context (P3 §7). It mounts before the canvas and owns the whole local-first
 * stack for one board: the `Y.Doc`, IndexedDB persistence, the undo manager, the snapshot
 * scheduler and the blob store. Zustand keeps only ephemeral UI state and is never persisted.
 */

import {
  createBoardDoc,
  createBoardHistory,
  migrateDocument,
  readMeta,
  type BoardHistory,
} from '@nexus/domain';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type * as Y from 'yjs';

import { createBlobStore, type BlobStore } from './opfs.ts';
import { createPersistence, type PersistenceHandle } from './persistence.ts';
import {
  createSnapshotScheduler,
  createSnapshotStore,
  type SnapshotScheduler,
  type SnapshotStore,
} from './snapshots.ts';
import { initialSyncStatus, type SyncStatus } from './syncStatus.ts';

export interface BoardDocValue {
  boardId: string;
  doc: Y.Doc;
  history: BoardHistory;
  status: SyncStatus;
  snapshots: SnapshotScheduler;
  snapshotStore: SnapshotStore;
  blobs: BlobStore;
  /** False until IndexedDB has been read; the canvas waits so it never paints an empty board. */
  ready: boolean;
  /** Set when storage is degraded (private mode, no OPFS) — surfaced as a banner. */
  storageWarning: string | null;
  retry: () => void;
}

const BoardDocContext = createContext<BoardDocValue | null>(null);

interface Bundle {
  doc: Y.Doc;
  history: BoardHistory;
  snapshotStore: SnapshotStore;
  snapshots: SnapshotScheduler;
  blobs: BlobStore;
}

export interface BoardDocProviderProps {
  boardId: string;
  children: ReactNode;
  /** Test seams; production uses IndexedDB/OPFS. */
  createPersistenceImpl?: typeof createPersistence;
  snapshotStoreImpl?: SnapshotStore;
  blobStoreImpl?: BlobStore;
}

export function BoardDocProvider({
  boardId,
  children,
  createPersistenceImpl,
  snapshotStoreImpl,
  blobStoreImpl,
}: BoardDocProviderProps) {
  const [status, setStatus] = useState<SyncStatus>(() => initialSyncStatus());
  const [ready, setReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const persistenceRef = useRef<PersistenceHandle | null>(null);
  // The whole stack is created *inside* the effect, not in a `useMemo`. React StrictMode (the dev
  // server, which is what e2e drives) mounts every effect twice: mount → cleanup → mount. A memoised
  // bundle would survive that cleanup already destroyed — the undo manager stayed dead and the Undo
  // button never left its disabled state in dev. Creating and destroying in the same effect makes
  // the second mount get a fresh, live bundle.
  const [bundle, setBundle] = useState<Bundle | null>(null);

  useEffect(() => {
    const doc = createBoardDoc({ boardId, now: new Date().toISOString() });
    const history = createBoardHistory(doc);
    const snapshotStore =
      snapshotStoreImpl ??
      // A browser without IndexedDB gets a store that fails loudly rather than silently.
      createSnapshotStore(globalThis.indexedDB);
    const snapshots = createSnapshotScheduler({ boardId, doc, store: snapshotStore });
    const blobs =
      blobStoreImpl ??
      createBlobStore({
        onFallback: (backend) =>
          setStorageWarning(
            backend === 'memory'
              ? 'Local file storage is unavailable, so attachments live in memory only. Export the board before closing this tab.'
              : 'This browser has no OPFS support; attachments are stored in IndexedDB instead.',
          ),
      });

    const factory = createPersistenceImpl ?? createPersistence;
    const handle = factory({ boardId, doc });
    persistenceRef.current = handle;
    const off = handle.subscribe(setStatus);

    setBundle({ doc, history, snapshotStore, snapshots, blobs });
    setReady(false);

    let cancelled = false;
    void handle.whenLoaded.then(() => {
      if (cancelled) return;
      // A document restored from IndexedDB may predate the current schema (08 §8.6).
      if (readMeta(doc) !== undefined) migrateDocument(doc, new Date().toISOString());
      setReady(true);
    });

    return () => {
      cancelled = true;
      off();
      snapshots.destroy();
      history.destroy();
      void handle.destroy();
      persistenceRef.current = null;
      setBundle(null);
      setReady(false);
    };
  }, [boardId, createPersistenceImpl, snapshotStoreImpl, blobStoreImpl]);

  const value = useMemo<BoardDocValue | null>(
    () =>
      bundle === null
        ? null
        : {
            boardId,
            doc: bundle.doc,
            history: bundle.history,
            snapshots: bundle.snapshots,
            snapshotStore: bundle.snapshotStore,
            blobs: bundle.blobs,
            status,
            ready,
            storageWarning,
            retry: () => persistenceRef.current?.retry(),
          },
    [boardId, bundle, status, ready, storageWarning],
  );

  // One tick with nothing rendered while the effect builds the stack: children must never run
  // without a live document, and `useBoardDoc`'s error must keep meaning "no provider above me".
  if (value === null) return null;
  return <BoardDocContext.Provider value={value}>{children}</BoardDocContext.Provider>;
}

export function useBoardDoc(): BoardDocValue {
  const value = useContext(BoardDocContext);
  if (value === null) {
    throw new Error('useBoardDoc must be used inside a <BoardDocProvider>.');
  }
  return value;
}

/** Subscribes a component to undo/redo availability without re-rendering on every frame. */
export function useHistoryState(history: BoardHistory) {
  const [state, setState] = useState(() => ({ ...history.state }));
  useEffect(() => history.subscribe(setState), [history]);
  return state;
}
