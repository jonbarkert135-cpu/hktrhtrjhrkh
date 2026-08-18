/**
 * The local workspace repository: projects and boards live in IndexedDB on this device.
 *
 * Why IndexedDB and not SQLite (docs/adr/ADR-003-local-database.md, short version): board content
 * is already an IndexedDB-backed CRDT and attachments are already OPFS. Adding SQLite would mean
 * either a native module (Electron) or a local Node process — i.e. reintroducing the backend that
 * local mode exists to avoid. The `WorkspaceRepository` interface is where a SQLite implementation
 * would slot in later without touching a single component.
 *
 * The store holds *metadata only*: the board document itself stays in `raven-board-<id>` (y-indexeddb)
 * and its blobs in OPFS. Deleting a board therefore never has to be a distributed transaction.
 */

import { newId } from '@nexus/domain';

import { WorkspaceError, type WorkspaceBoard, type WorkspaceProject } from './types.ts';
import type { WorkspaceRepository } from './types.ts';

const DB_NAME = 'raven-workspace';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const BOARDS = 'boards';

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) {
        db.createObjectStore(PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(BOARDS)) {
        db.createObjectStore(BOARDS, { keyPath: 'id' }).createIndex('projectId', 'projectId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('This browser would not open its local database.'));
  });
}

/** Maps a storage exception to copy the user can act on (P3 §8: quota, private browsing). */
const asWorkspaceError = (error: unknown): WorkspaceError => {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'QuotaExceededError' || /quota/i.test(message)) {
    return new WorkspaceError(
      'This device is out of storage, so the change could not be saved. Free some space, then retry.',
      { cause: error },
    );
  }
  return new WorkspaceError(
    'Local storage is unavailable (private browsing?). Your work stays in this tab only — export it before closing.',
    { cause: error },
  );
};

export interface LocalWorkspaceOptions {
  /** Injected in tests; production uses the browser factory. */
  factory?: IDBFactory | undefined;
  now?: (() => string) | undefined;
}

export function createLocalWorkspaceRepository(
  options: LocalWorkspaceOptions = {},
): WorkspaceRepository {
  const factory = options.factory ?? globalThis.indexedDB;
  const now = options.now ?? (() => new Date().toISOString());

  const run = async <T>(
    store: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    if (factory === undefined) {
      throw new WorkspaceError(
        'Local storage is unavailable in this browser, so projects cannot be saved. Try a normal (non-private) window.',
      );
    }
    let db: IDBDatabase;
    try {
      db = await open(factory);
    } catch (error) {
      throw asWorkspaceError(error);
    }
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = fn(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(asWorkspaceError(request.error));
        tx.onabort = () => reject(asWorkspaceError(tx.error));
      });
    } finally {
      db.close();
    }
  };

  const byCreatedAt = <T extends { createdAt: string }>(rows: T[]): T[] =>
    [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    kind: 'local',

    async listProjects() {
      const rows = await run<WorkspaceProject[]>(
        PROJECTS,
        'readonly',
        (store) => store.getAll() as IDBRequest<WorkspaceProject[]>,
      );
      return byCreatedAt(rows);
    },

    async createProject({ name }) {
      const trimmed = name.trim();
      if (trimmed === '') throw new WorkspaceError('Give the project a name first.');
      const project: WorkspaceProject = { id: newId.project(), name: trimmed, createdAt: now() };
      await run(PROJECTS, 'readwrite', (store) => store.add(project));
      return project;
    },

    async listBoards(projectId) {
      const rows = await run<WorkspaceBoard[]>(
        BOARDS,
        'readonly',
        (store) => store.index('projectId').getAll(projectId) as IDBRequest<WorkspaceBoard[]>,
      );
      return byCreatedAt(rows);
    },

    async createBoard({ projectId, title, id }) {
      const trimmed = title.trim();
      if (trimmed === '') throw new WorkspaceError('Give the board a title first.');
      const board: WorkspaceBoard = {
        id: id ?? newId.board(),
        projectId,
        title: trimmed,
        createdAt: now(),
      };
      await run(BOARDS, 'readwrite', (store) => store.put(board));
      return board;
    },
  };
}
