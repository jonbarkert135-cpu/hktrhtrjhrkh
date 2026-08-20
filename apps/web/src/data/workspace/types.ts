/**
 * The workspace repository: the one interface the UI uses to see projects and boards.
 *
 * There are two implementations and the UI cannot tell them apart:
 *   - `local.ts`   — IndexedDB on this device. No account, no server, works offline (APP_MODE=local)
 *   - `server.ts`  — the tRPC API, scoped to the signed-in org (APP_MODE=server)
 *
 * The interface is intentionally promise-based and free of React, tRPC and Prisma types. Anything
 * that shows up here would have to be implemented by *both* sides, which is the check that keeps
 * server concepts (orgs, roles, cursors) from quietly becoming requirements of local mode.
 *
 * P7 extends this with the rest of project/board management (rename, archive, delete, duplicate,
 * move, templates) plus the denormalized counters the board grid and search results show. Member
 * management (invite-by-email, per-project roles) is deliberately **not** here: this repo's only
 * multi-user concept is the org-level `Membership` role (`09_BACKEND.md` §3.1, already shipped),
 * and local mode has no accounts at all, so a second, project-scoped membership model — plus the
 * mailer an invite flow needs — is out of this phase's boundary (`20_ROADMAP.md` P7 §2 rule 5) and
 * belongs with the auth/backend phase that gives it somewhere real to send an email.
 */

export interface WorkspaceProject {
  id: string;
  name: string;
  /** Design-token name (e.g. `--project-blue`), or null for the default. */
  color: string | null;
  /** Icon id from the shared icon set, or null for the initial-letter fallback. */
  icon: string | null;
  /** ISO-8601, or null while active. Archived projects are hidden by default (P7 §6). */
  archivedAt: string | null;
  /** ISO-8601. Used for ordering, so both implementations must set it. */
  createdAt: string;
}

export interface WorkspaceBoard {
  id: string;
  projectId: string;
  title: string;
  /** Icon id, or null for the type-default glyph. */
  icon: string | null;
  /** ISO-8601, or null while active. */
  archivedAt: string | null;
  /** The board this one was created from (built-in id or another board's id), or null. */
  templateOf: string | null;
  /** Flagged reusable by "save as template" (P7 §5.4); ordinary boards otherwise. */
  isTemplate: boolean;
  /** ISO-8601, or null if never opened since creation. Drives "recently opened" sort (P7 §6). */
  lastOpenedAt: string | null;
  /**
   * Denormalized counters. Until the sync projection (P8) owns them, the client reports the count
   * it just saved and the server (or local store) clamps it to a sane range — P7 §5.1.
   */
  nodeCount: number;
  edgeCount: number;
  /** ISO-8601. Used for ordering, so both implementations must set it. */
  createdAt: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface ListBoardsOptions {
  /** Defaults to false: archived boards are hidden unless asked for (P7 §6). */
  includeArchived?: boolean;
}

export interface ListProjectsOptions {
  includeArchived?: boolean;
}

export interface WorkspaceRepository {
  /** Which implementation answered — surfaced in Settings, and asserted in tests. */
  readonly kind: 'local' | 'server';
  /**
   * The caller's capability in this workspace. Local mode is always `'owner'` (one device, one
   * user, N2); server mode reflects the org membership role. Drives every disabled control and
   * palette `when()` gate (P7 §12) — never post-filtered in the UI alone.
   */
  role: () => WorkspaceRole;

  listProjects: (options?: ListProjectsOptions) => Promise<WorkspaceProject[]>;
  createProject: (input: {
    name: string;
    color?: string;
    icon?: string;
  }) => Promise<WorkspaceProject>;
  renameProject: (input: { projectId: string; name: string }) => Promise<WorkspaceProject>;
  setProjectAppearance: (input: {
    projectId: string;
    color?: string | null;
    icon?: string | null;
  }) => Promise<WorkspaceProject>;
  archiveProject: (input: { projectId: string }) => Promise<WorkspaceProject>;
  restoreProject: (input: { projectId: string }) => Promise<WorkspaceProject>;
  /** Soft delete; confirmName must equal the current project name (N8). */
  deleteProject: (input: { projectId: string; confirmName: string }) => Promise<{ ok: true }>;

  listBoards: (projectId: string, options?: ListBoardsOptions) => Promise<WorkspaceBoard[]>;
  /**
   * `id` is optional and only honoured by the local implementation: first-run bootstrap adopts the
   * scratch document instead of minting a second board (see bootstrap.ts). `templateId` is either
   * a built-in template id (`packages/domain` `BUILTIN_TEMPLATES`) or another board's id.
   */
  createBoard: (input: {
    projectId: string;
    title: string;
    id?: string | undefined;
    templateId?: string | undefined;
  }) => Promise<WorkspaceBoard>;
  renameBoard: (input: { boardId: string; title: string }) => Promise<WorkspaceBoard>;
  moveBoard: (input: { boardId: string; projectId: string }) => Promise<WorkspaceBoard>;
  archiveBoard: (input: { boardId: string }) => Promise<WorkspaceBoard>;
  restoreBoard: (input: { boardId: string }) => Promise<WorkspaceBoard>;
  deleteBoard: (input: { boardId: string }) => Promise<{ ok: true }>;
  /** Deep copy: local mode copies the Y.Doc and OPFS files; server mode copies the metadata row
   *  and defers content copy to the sync service (P8) — see `server.ts` for the documented gap. */
  duplicateBoard: (input: { boardId: string; title?: string }) => Promise<WorkspaceBoard>;
  /** Flags a board reusable as a template ("save any board as a template", P7 §5.4). */
  saveBoardAsTemplate: (input: { boardId: string }) => Promise<WorkspaceBoard>;
  /** Records that the board was opened, for the "last opened" sort. Fire-and-forget from the UI. */
  touchBoardOpened: (input: { boardId: string }) => Promise<void>;
  /** Reports the board's current element counts after a save (P7 §5.1). Clamped server-side. */
  reportBoardCounts: (input: {
    boardId: string;
    nodeCount: number;
    edgeCount: number;
  }) => Promise<void>;
}

/** Thrown by both implementations, already phrased for the user (03_UX.md §12.1). */
export class WorkspaceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkspaceError';
  }
}
