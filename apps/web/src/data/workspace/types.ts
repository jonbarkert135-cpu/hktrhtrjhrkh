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
 */

export interface WorkspaceProject {
  id: string;
  name: string;
  /** ISO-8601. Used for ordering, so both implementations must set it. */
  createdAt: string;
}

export interface WorkspaceBoard {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
}

export interface WorkspaceRepository {
  /** Which implementation answered — surfaced in Settings, and asserted in tests. */
  readonly kind: 'local' | 'server';
  // Arrow-typed properties, not method shorthand: these are injected functions that are passed
  // around (and asserted on in tests) detached from the object, which method shorthand makes
  // unsafe — see @typescript-eslint/unbound-method.
  listProjects: () => Promise<WorkspaceProject[]>;
  createProject: (input: { name: string }) => Promise<WorkspaceProject>;
  listBoards: (projectId: string) => Promise<WorkspaceBoard[]>;
  createBoard: (input: { projectId: string; title: string }) => Promise<WorkspaceBoard>;
}

/** Thrown by both implementations, already phrased for the user (03_UX.md §12.1). */
export class WorkspaceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkspaceError';
  }
}
