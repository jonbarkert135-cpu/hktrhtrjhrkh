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
 * `duplicateBoard` is the one exception (P7 §5.3): it reaches into both to produce a real deep copy.
 *
 * Soft delete (P7 §2 rule 2/3): a deleted row keeps `deletedAt` and is filtered out of every list;
 * `purgeExpired` drops rows past the 30-day undo window. It runs opportunistically on every read
 * instead of a background job, because local mode has no job runner and "next time the app is
 * open" is close enough for a client-only undo window.
 */

import { boardRoots, newId } from '@nexus/domain';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { createBlobStore } from '../opfs.ts';
import { localRuns } from './runs.ts';
import { boardStoreName } from '../persistence.ts';
import { WorkspaceError, type WorkspaceBoard, type WorkspaceProject } from './types.ts';
import type { ListBoardsOptions, ListProjectsOptions, WorkspaceRepository } from './types.ts';

const DB_NAME = 'raven-workspace';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const BOARDS = 'boards';

/** Soft-deleted rows are purged this long after `deletedAt` (P7 §2 rule 3). */
export const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

interface ProjectRow extends WorkspaceProject {
  deletedAt: string | null;
}

interface BoardRow extends WorkspaceBoard {
  deletedAt: string | null;
}

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

/** Waits for a fresh `IndexeddbPersistence` to finish its initial load/flush. */
async function synced(provider: IndexeddbPersistence): Promise<void> {
  await provider.whenSynced;
}

/**
 * Clones a board's Y.Doc state and every file it references from `sourceId` to `targetId`
 * (P7 §5.3, §7: "no download/upload round-trip" — this never leaves the device). Best-effort on
 * the file copy: a missing blob (already GC'd, storage pressure) is skipped rather than failing
 * the whole duplicate, since the doc itself is what makes a board usable.
 */
async function copyBoardContent(
  factory: IDBFactory | undefined,
  sourceId: string,
  targetId: string,
): Promise<void> {
  if (factory === undefined) return;

  const sourceDoc = new Y.Doc();
  const sourceProvider = new IndexeddbPersistence(boardStoreName(sourceId), sourceDoc);
  await synced(sourceProvider);
  const update = Y.encodeStateAsUpdate(sourceDoc);
  const assetIds = [...boardRoots(sourceDoc).assets.keys()];
  await sourceProvider.destroy();

  const targetDoc = new Y.Doc();
  Y.applyUpdate(targetDoc, update, 'system:duplicate');
  const targetProvider = new IndexeddbPersistence(boardStoreName(targetId), targetDoc);
  await synced(targetProvider);
  await targetProvider.destroy();

  if (assetIds.length === 0) return;
  const blobs = createBlobStore({ indexedDB: factory });
  for (const assetId of assetIds) {
    const blob = await blobs.get(sourceId, assetId);
    if (blob !== null) await blobs.put(targetId, assetId, blob);
  }
}

const notFound = (kind: 'project' | 'board'): WorkspaceError =>
  new WorkspaceError(`That ${kind} no longer exists. It may have been deleted on this device.`);

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

  const getRow = async <T>(store: string, id: string): Promise<T | undefined> =>
    run<T | undefined>(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);

  const putRow = async <T>(store: string, row: T): Promise<void> => {
    await run(store, 'readwrite', (s) => s.put(row));
  };

  const byCreatedAt = <T extends { createdAt: string }>(rows: T[]): T[] =>
    [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const isExpired = (row: { deletedAt: string | null }): boolean =>
    row.deletedAt !== null && Date.now() - Date.parse(row.deletedAt) > PURGE_AFTER_MS;

  const purgeExpired = async (store: string, rows: { id: string; deletedAt: string | null }[]) => {
    const expired = rows.filter(isExpired);
    if (expired.length === 0) return;
    await run(store, 'readwrite', (s) => {
      for (const row of expired) s.delete(row.id);
      // The caller only awaits the request its callback returns; issuing the deletes above and
      // returning a no-op get keeps this helper inside the single-request `run` contract.
      return s.get(expired[0]?.id ?? '');
    });
  };

  const toProjectDto = (row: ProjectRow): WorkspaceProject => {
    const { deletedAt: _deletedAt, ...dto } = row;
    return dto;
  };
  const toBoardDto = (row: BoardRow): WorkspaceBoard => {
    const { deletedAt: _deletedAt, ...dto } = row;
    return dto;
  };

  const requireProject = async (projectId: string): Promise<ProjectRow> => {
    const row = await getRow<ProjectRow>(PROJECTS, projectId);
    if (row === undefined || row.deletedAt !== null) throw notFound('project');
    return row;
  };

  const requireBoard = async (boardId: string): Promise<BoardRow> => {
    const row = await getRow<BoardRow>(BOARDS, boardId);
    if (row === undefined || row.deletedAt !== null) throw notFound('board');
    return row;
  };

  return {
    kind: 'local',
    // One device, one user: local mode has no roles to check (N2 — see types.ts).
    role: () => 'owner',

    async listProjects(listOptions: ListProjectsOptions = {}) {
      const rows = await run<ProjectRow[]>(
        PROJECTS,
        'readonly',
        (store) => store.getAll() as IDBRequest<ProjectRow[]>,
      );
      await purgeExpired(PROJECTS, rows);
      const visible = rows.filter(
        (row) =>
          row.deletedAt === null &&
          (listOptions.includeArchived === true || row.archivedAt === null),
      );
      return byCreatedAt(visible).map(toProjectDto);
    },

    async createProject({ name, color, icon }) {
      const trimmed = name.trim();
      if (trimmed === '') throw new WorkspaceError('Give the project a name first.');
      const row: ProjectRow = {
        id: newId.project(),
        name: trimmed,
        color: color ?? null,
        icon: icon ?? null,
        archivedAt: null,
        deletedAt: null,
        createdAt: now(),
      };
      await putRow(PROJECTS, row);
      return toProjectDto(row);
    },

    async renameProject({ projectId, name }) {
      const trimmed = name.trim();
      if (trimmed === '') throw new WorkspaceError('Give the project a name first.');
      const row = await requireProject(projectId);
      const updated: ProjectRow = { ...row, name: trimmed };
      await putRow(PROJECTS, updated);
      return toProjectDto(updated);
    },

    async setProjectAppearance({ projectId, color, icon }) {
      const row = await requireProject(projectId);
      const updated: ProjectRow = {
        ...row,
        ...(color !== undefined ? { color } : {}),
        ...(icon !== undefined ? { icon } : {}),
      };
      await putRow(PROJECTS, updated);
      return toProjectDto(updated);
    },

    async archiveProject({ projectId }) {
      const row = await requireProject(projectId);
      const updated: ProjectRow = { ...row, archivedAt: now() };
      await putRow(PROJECTS, updated);
      return toProjectDto(updated);
    },

    async restoreProject({ projectId }) {
      const row = await requireProject(projectId);
      const updated: ProjectRow = { ...row, archivedAt: null };
      await putRow(PROJECTS, updated);
      return toProjectDto(updated);
    },

    async deleteProject({ projectId, confirmName }) {
      const row = await requireProject(projectId);
      if (row.name !== confirmName) {
        throw new WorkspaceError('The name you typed does not match the project name.');
      }
      const updated: ProjectRow = { ...row, deletedAt: now() };
      await putRow(PROJECTS, updated);
      return { ok: true as const };
    },

    async listBoards(projectId, listOptions: ListBoardsOptions = {}) {
      const rows = await run<BoardRow[]>(
        BOARDS,
        'readonly',
        (store) => store.index('projectId').getAll(projectId) as IDBRequest<BoardRow[]>,
      );
      await purgeExpired(BOARDS, rows);
      const visible = rows.filter(
        (row) =>
          row.deletedAt === null &&
          (listOptions.includeArchived === true || row.archivedAt === null),
      );
      return byCreatedAt(visible).map(toBoardDto);
    },

    async createBoard({ projectId, title, id, templateId }) {
      const trimmed = title.trim();
      if (trimmed === '') throw new WorkspaceError('Give the board a title first.');
      const row: BoardRow = {
        id: id ?? newId.board(),
        projectId,
        title: trimmed,
        icon: null,
        archivedAt: null,
        templateOf: templateId ?? null,
        isTemplate: false,
        lastOpenedAt: null,
        nodeCount: 0,
        edgeCount: 0,
        deletedAt: null,
        createdAt: now(),
      };
      await putRow(BOARDS, row);
      return toBoardDto(row);
    },

    async renameBoard({ boardId, title }) {
      const trimmed = title.trim();
      if (trimmed === '') throw new WorkspaceError('Give the board a title first.');
      const row = await requireBoard(boardId);
      const updated: BoardRow = { ...row, title: trimmed };
      await putRow(BOARDS, updated);
      return toBoardDto(updated);
    },

    async moveBoard({ boardId, projectId }) {
      const row = await requireBoard(boardId);
      const updated: BoardRow = { ...row, projectId };
      await putRow(BOARDS, updated);
      return toBoardDto(updated);
    },

    async archiveBoard({ boardId }) {
      const row = await requireBoard(boardId);
      const updated: BoardRow = { ...row, archivedAt: now() };
      await putRow(BOARDS, updated);
      return toBoardDto(updated);
    },

    async restoreBoard({ boardId }) {
      const row = await requireBoard(boardId);
      const updated: BoardRow = { ...row, archivedAt: null };
      await putRow(BOARDS, updated);
      return toBoardDto(updated);
    },

    async deleteBoard({ boardId }) {
      const row = await requireBoard(boardId);
      const updated: BoardRow = { ...row, deletedAt: now() };
      await putRow(BOARDS, updated);
      return { ok: true as const };
    },

    /**
     * Deep copy (P7 §5.3): the Y.Doc content and every attached file, plus a fresh metadata row.
     * This is the one operation where the local repository reaches past its own metadata store —
     * duplication is a single user action and needs to be all-or-nothing, so it is done here
     * rather than choreographed by a caller that does not know when "the doc is loaded" is true.
     */
    async duplicateBoard({ boardId, title }) {
      const source = await requireBoard(boardId);
      const targetId = newId.board();
      await copyBoardContent(factory, source.id, targetId);

      const row: BoardRow = {
        ...source,
        id: targetId,
        title: (title ?? `${source.title} copy`).trim() || `${source.title} copy`,
        templateOf: source.id,
        isTemplate: false,
        lastOpenedAt: null,
        deletedAt: null,
        createdAt: now(),
      };
      await putRow(BOARDS, row);
      return toBoardDto(row);
    },

    async saveBoardAsTemplate({ boardId }) {
      const row = await requireBoard(boardId);
      const updated: BoardRow = { ...row, isTemplate: true };
      await putRow(BOARDS, updated);
      return toBoardDto(updated);
    },

    async touchBoardOpened({ boardId }) {
      const row = await getRow<BoardRow>(BOARDS, boardId);
      if (row === undefined || row.deletedAt !== null) return;
      await putRow(BOARDS, { ...row, lastOpenedAt: now() });
    },

    // P9: integrations are server-only. These throw rather than no-op so an accidental call in
    // local mode fails loudly (localMode.test.tsx).
    runs: localRuns(),

    async reportBoardCounts({ boardId, nodeCount, edgeCount }) {
      const row = await getRow<BoardRow>(BOARDS, boardId);
      if (row === undefined || row.deletedAt !== null) return;
      // Sanity clamp (P7 §5.1): a save can only report non-negative, finite counts.
      const clamp = (n: number): number => (Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);
      await putRow(BOARDS, { ...row, nodeCount: clamp(nodeCount), edgeCount: clamp(edgeCount) });
    },
  };
}
