/**
 * The server workspace repository: the same interface, answered by the tRPC API.
 *
 * It takes the four procedures it needs rather than the whole client, so the local build never
 * pulls the API router types into a code path it does not use, and so the tests here do not need a
 * tRPC provider to run.
 */

import { WorkspaceError, type WorkspaceBoard, type WorkspaceProject } from './types.ts';
import type { WorkspaceRepository } from './types.ts';

export interface WorkspaceApi {
  listProjects: (
    input: Record<string, never>,
  ) => Promise<readonly { id: string; name: string; createdAt: Date | string }[]>;
  createProject: (input: {
    name: string;
  }) => Promise<{ id: string; name: string; createdAt: Date | string }>;
  listBoards: (input: {
    projectId: string;
  }) => Promise<
    readonly { id: string; projectId: string; title: string; createdAt: Date | string }[]
  >;
  createBoard: (input: {
    projectId: string;
    title: string;
  }) => Promise<{ id: string; projectId: string; title: string; createdAt: Date | string }>;
}

const iso = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

const project = (row: {
  id: string;
  name: string;
  createdAt: Date | string;
}): WorkspaceProject => ({
  id: row.id,
  name: row.name,
  createdAt: iso(row.createdAt),
});

const board = (row: {
  id: string;
  projectId: string;
  title: string;
  createdAt: Date | string;
}): WorkspaceBoard => ({
  id: row.id,
  projectId: row.projectId,
  title: row.title,
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

export function createServerWorkspaceRepository(api: WorkspaceApi): WorkspaceRepository {
  return {
    kind: 'server',
    listProjects: () => rethrow(async () => (await api.listProjects({})).map(project)),
    createProject: (input) => rethrow(async () => project(await api.createProject(input))),
    listBoards: (projectId) =>
      rethrow(async () => (await api.listBoards({ projectId })).map(board)),
    // The optional `id` is a local-mode affordance; the server mints its own ids, so it is dropped
    // here rather than sent to a router that would reject the unknown key.
    createBoard: ({ projectId, title }) =>
      rethrow(async () => board(await api.createBoard({ projectId, title }))),
  };
}
