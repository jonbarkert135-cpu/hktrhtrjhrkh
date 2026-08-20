/**
 * The server workspace repository: the same interface, answered by the tRPC API.
 *
 * It takes the procedures it needs rather than the whole client, so the local build never pulls
 * the API router types into a code path it does not use, and so the tests here do not need a
 * tRPC provider to run.
 */

import {
  WorkspaceError,
  type WorkspaceBoard,
  type WorkspaceProject,
  type WorkspaceRole,
} from './types.ts';
import type { ListBoardsOptions, ListProjectsOptions, WorkspaceRepository } from './types.ts';

interface ProjectRow {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  archivedAt: Date | string | null;
  createdAt: Date | string;
}

interface BoardRow {
  id: string;
  projectId: string;
  title: string;
  icon: string | null;
  templateOf: string | null;
  isTemplate: boolean;
  archivedAt: Date | string | null;
  lastOpenedAt: Date | string | null;
  nodeCount: number;
  edgeCount: number;
  createdAt: Date | string;
}

type Ok = { ok: true };

export interface WorkspaceApi {
  listProjects: (input: { includeArchived: boolean }) => Promise<readonly ProjectRow[]>;
  createProject: (input: { name: string; color?: string; icon?: string }) => Promise<ProjectRow>;
  renameProject: (input: { projectId: string; name: string }) => Promise<ProjectRow>;
  setProjectAppearance: (input: {
    projectId: string;
    color?: string | null;
    icon?: string | null;
  }) => Promise<ProjectRow>;
  archiveProject: (input: { projectId: string }) => Promise<ProjectRow>;
  restoreProject: (input: { projectId: string }) => Promise<ProjectRow>;
  deleteProject: (input: { projectId: string; confirmName: string }) => Promise<Ok>;

  listBoards: (input: {
    projectId: string;
    includeArchived: boolean;
  }) => Promise<readonly BoardRow[]>;
  createBoard: (input: {
    projectId: string;
    title: string;
    templateId?: string | undefined;
  }) => Promise<BoardRow>;
  renameBoard: (input: { boardId: string; title: string }) => Promise<BoardRow>;
  moveBoard: (input: { boardId: string; projectId: string }) => Promise<BoardRow>;
  archiveBoard: (input: { boardId: string }) => Promise<BoardRow>;
  restoreBoard: (input: { boardId: string }) => Promise<BoardRow>;
  deleteBoard: (input: { boardId: string }) => Promise<Ok>;
  duplicateBoard: (input: { boardId: string; title?: string | undefined }) => Promise<BoardRow>;
  saveBoardAsTemplate: (input: { boardId: string }) => Promise<BoardRow>;
  touchBoardOpened: (input: { boardId: string }) => Promise<Ok>;
  reportBoardCounts: (input: {
    boardId: string;
    nodeCount: number;
    edgeCount: number;
  }) => Promise<Ok>;
}

const iso = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();
const isoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : iso(value);

const project = (row: ProjectRow): WorkspaceProject => ({
  id: row.id,
  name: row.name,
  color: row.color,
  icon: row.icon,
  archivedAt: isoOrNull(row.archivedAt),
  createdAt: iso(row.createdAt),
});

const board = (row: BoardRow): WorkspaceBoard => ({
  id: row.id,
  projectId: row.projectId,
  title: row.title,
  icon: row.icon,
  archivedAt: isoOrNull(row.archivedAt),
  templateOf: row.templateOf,
  isTemplate: row.isTemplate,
  lastOpenedAt: isoOrNull(row.lastOpenedAt),
  nodeCount: row.nodeCount,
  edgeCount: row.edgeCount,
  createdAt: iso(row.createdAt),
});

/**
 * tRPC errors already carry user-facing copy through `errorMessage()`; anything that escapes that
 * (a dropped connection, a CORS failure) becomes one sentence instead of a stack trace.
 */
const rethrow = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.name === 'TRPCClientError') throw error;
    throw new WorkspaceError(
      'The server could not be reached. Check your connection and try again — nothing was changed.',
      { cause: error },
    );
  }
};

export interface ServerWorkspaceOptions {
  /**
   * The caller's org role, for palette/UI gating only (never the security boundary — the server
   * enforces the real role via `orgProcedure` on every procedure above). Defaults to `'editor'`
   * because there is nowhere yet to fetch the real per-org role from: `auth.session` exists
   * (`09_BACKEND.md` §3.1) but wiring it into this bridge is P9's job, not P7's — see
   * `TrpcWorkspaceBridge` in `context.tsx`.
   */
  role?: () => WorkspaceRole;
}

export function createServerWorkspaceRepository(
  api: WorkspaceApi,
  options: ServerWorkspaceOptions = {},
): WorkspaceRepository {
  const role = options.role ?? (() => 'editor');

  return {
    kind: 'server',
    role,

    listProjects: (listOptions: ListProjectsOptions = {}) =>
      rethrow(async () =>
        (await api.listProjects({ includeArchived: listOptions.includeArchived ?? false })).map(
          project,
        ),
      ),
    createProject: (input) => rethrow(async () => project(await api.createProject(input))),
    renameProject: (input) => rethrow(async () => project(await api.renameProject(input))),
    setProjectAppearance: (input) =>
      rethrow(async () => project(await api.setProjectAppearance(input))),
    archiveProject: (input) => rethrow(async () => project(await api.archiveProject(input))),
    restoreProject: (input) => rethrow(async () => project(await api.restoreProject(input))),
    deleteProject: (input) => rethrow(() => api.deleteProject(input)),

    listBoards: (projectId, listOptions: ListBoardsOptions = {}) =>
      rethrow(async () =>
        (
          await api.listBoards({ projectId, includeArchived: listOptions.includeArchived ?? false })
        ).map(board),
      ),
    // The optional local `id` is a local-mode affordance; the server mints its own ids, so it is
    // dropped here rather than sent to a router that would reject the unknown key.
    createBoard: ({ projectId, title, templateId }) =>
      rethrow(async () =>
        board(
          await api.createBoard({
            projectId,
            title,
            ...(templateId === undefined ? {} : { templateId }),
          }),
        ),
      ),
    renameBoard: (input) => rethrow(async () => board(await api.renameBoard(input))),
    moveBoard: (input) => rethrow(async () => board(await api.moveBoard(input))),
    archiveBoard: (input) => rethrow(async () => board(await api.archiveBoard(input))),
    restoreBoard: (input) => rethrow(async () => board(await api.restoreBoard(input))),
    deleteBoard: (input) => rethrow(() => api.deleteBoard(input)),
    duplicateBoard: (input) => rethrow(async () => board(await api.duplicateBoard(input))),
    saveBoardAsTemplate: (input) =>
      rethrow(async () => board(await api.saveBoardAsTemplate(input))),
    touchBoardOpened: (input) => rethrow(async () => void (await api.touchBoardOpened(input))),
    reportBoardCounts: (input) => rethrow(async () => void (await api.reportBoardCounts(input))),
  };
}
