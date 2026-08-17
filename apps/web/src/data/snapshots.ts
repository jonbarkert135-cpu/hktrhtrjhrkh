/**
 * Local version history (P3 §5.10). A compacted `Y.encodeStateAsUpdate` is stored in IndexedDB
 * every 200 operations or every 5 minutes of activity; the newest 20 are kept.
 *
 * Restore is a normal operation with a local origin, so it is itself undoable and never rewrites
 * history (P3 §6, acceptance criterion 5).
 */

import { countEntities, restoreFromUpdate, type RestoreReport } from '@nexus/domain';
import * as Y from 'yjs';

export const SNAPSHOT_OPERATION_INTERVAL = 200;
export const SNAPSHOT_TIME_INTERVAL_MS = 5 * 60 * 1000;
export const SNAPSHOT_RETENTION = 20;

const DB_NAME = 'nexus-snapshots';
const STORE = 'snapshots';

export interface SnapshotRecord {
  id: string;
  boardId: string;
  createdAt: number;
  nodeCount: number;
  edgeCount: number;
  update: Uint8Array;
  reason: 'auto' | 'checkpoint' | 'pre-import';
}

export type SnapshotSummary = Omit<SnapshotRecord, 'update'>;

export interface SnapshotStore {
  save(record: SnapshotRecord): Promise<void>;
  list(boardId: string): Promise<SnapshotSummary[]>;
  load(id: string): Promise<SnapshotRecord | null>;
  prune(boardId: string, keep?: number): Promise<number>;
}

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('boardId', 'boardId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'));
  });
}

export function createSnapshotStore(factory: IDBFactory = globalThis.indexedDB): SnapshotStore {
  const run = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await open(factory);
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Snapshot store write failed'));
      });
    } finally {
      db.close();
    }
  };

  const byBoard = async (boardId: string): Promise<SnapshotRecord[]> => {
    const all = await run<SnapshotRecord[]>(
      'readonly',
      (store) => store.getAll() as IDBRequest<SnapshotRecord[]>,
    );
    return all
      .filter((record) => record.boardId === boardId)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  };

  return {
    async save(record) {
      await run('readwrite', (store) => store.put(record));
      await this.prune(record.boardId);
    },
    async list(boardId) {
      return (await byBoard(boardId)).map(({ update: _update, ...summary }) => summary);
    },
    async load(id) {
      const record = await run<SnapshotRecord | undefined>(
        'readonly',
        (store) => store.get(id) as IDBRequest<SnapshotRecord | undefined>,
      );
      return record ?? null;
    },
    async prune(boardId, keep = SNAPSHOT_RETENTION) {
      const records = await byBoard(boardId);
      const doomed = records.slice(keep);
      for (const record of doomed) await run('readwrite', (store) => store.delete(record.id));
      return doomed.length;
    },
  };
}

export interface SnapshotSchedulerOptions {
  boardId: string;
  doc: Y.Doc;
  store: SnapshotStore;
  now?: () => number;
  newId?: () => string;
  operationInterval?: number;
  timeIntervalMs?: number;
  onError?: (error: unknown) => void;
}

export interface SnapshotScheduler {
  /** Writes a snapshot immediately (named checkpoint, or before an import). */
  capture(reason?: SnapshotRecord['reason']): Promise<SnapshotRecord | null>;
  /** Operations counted since the last snapshot — exposed for tests and the history panel. */
  readonly pending: number;
  destroy(): void;
}

export function snapshotOf(
  doc: Y.Doc,
  boardId: string,
  id: string,
  createdAt: number,
  reason: SnapshotRecord['reason'],
): SnapshotRecord {
  return {
    id,
    boardId,
    createdAt,
    reason,
    nodeCount: countEntities(doc).nodes,
    edgeCount: countEntities(doc).edges,
    update: Y.encodeStateAsUpdate(doc),
  };
}

export function createSnapshotScheduler(options: SnapshotSchedulerOptions): SnapshotScheduler {
  const now = options.now ?? (() => Date.now());
  const newId =
    options.newId ?? (() => `snap_${String(now())}_${Math.random().toString(36).slice(2, 8)}`);
  const operationInterval = options.operationInterval ?? SNAPSHOT_OPERATION_INTERVAL;
  const timeInterval = options.timeIntervalMs ?? SNAPSHOT_TIME_INTERVAL_MS;

  let operations = 0;
  let lastSnapshotAt = now();

  const capture = async (
    reason: SnapshotRecord['reason'] = 'auto',
  ): Promise<SnapshotRecord | null> => {
    const record = snapshotOf(options.doc, options.boardId, newId(), now(), reason);
    operations = 0;
    lastSnapshotAt = record.createdAt;
    try {
      await options.store.save(record);
      return record;
    } catch (error) {
      options.onError?.(error);
      return null;
    }
  };

  const onUpdate = (_update: Uint8Array, origin: unknown): void => {
    // Snapshots track *content* history; provider replays and remote syncs do not count.
    if (origin === 'remote:sync') return;
    operations += 1;
    if (operations >= operationInterval || now() - lastSnapshotAt >= timeInterval) {
      void capture('auto');
    }
  };

  options.doc.on('update', onUpdate);

  return {
    capture,
    get pending() {
      return operations;
    },
    destroy() {
      options.doc.off('update', onUpdate);
    },
  };
}

/** Re-exported so the UI imports one persistence module; the write itself lives in the domain. */
export function restoreSnapshot(doc: Y.Doc, record: SnapshotRecord): RestoreReport {
  return restoreFromUpdate(doc, record.update, 'local:action');
}
