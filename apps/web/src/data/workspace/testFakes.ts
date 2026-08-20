/**
 * A fully-typed fake `WorkspaceRepository`, shared by every test that mounts a component under
 * `WorkspaceProvider`. Kept here (not in a `*.test.ts` file) so it is importable from any test
 * without pulling in a whole suite — the same pattern as `packages/domain/test/factories.ts`.
 */

import { vi } from 'vitest';

import type {
  WorkspaceBoard,
  WorkspaceProject,
  WorkspaceRepository,
  WorkspaceRole,
} from './types.ts';

export function fakeProject(overrides: Partial<WorkspaceProject> = {}): WorkspaceProject {
  return {
    id: 'p1',
    name: 'Atlas',
    color: null,
    icon: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function fakeBoard(overrides: Partial<WorkspaceBoard> = {}): WorkspaceBoard {
  return {
    id: 'b1',
    projectId: 'p1',
    title: 'Timeline',
    icon: null,
    archivedAt: null,
    templateOf: null,
    isTemplate: false,
    lastOpenedAt: null,
    nodeCount: 0,
    edgeCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Every method is a `vi.fn()` with a reasonable default, so a test only overrides what it needs. */
export function fakeWorkspaceRepository(
  overrides: Partial<WorkspaceRepository> = {},
): WorkspaceRepository {
  const project = fakeProject();
  const board = fakeBoard();
  return {
    kind: 'local',
    role: vi.fn((): WorkspaceRole => 'owner'),
    listProjects: vi.fn(() => Promise.resolve([project])),
    createProject: vi.fn((input: { name: string }) =>
      Promise.resolve(fakeProject({ id: 'p2', name: input.name })),
    ),
    renameProject: vi.fn((input: { projectId: string; name: string }) =>
      Promise.resolve(fakeProject({ id: input.projectId, name: input.name })),
    ),
    setProjectAppearance: vi.fn((input: { projectId: string }) =>
      Promise.resolve(fakeProject({ id: input.projectId })),
    ),
    archiveProject: vi.fn((input: { projectId: string }) =>
      Promise.resolve(fakeProject({ id: input.projectId, archivedAt: '2026-02-01T00:00:00.000Z' })),
    ),
    restoreProject: vi.fn((input: { projectId: string }) =>
      Promise.resolve(fakeProject({ id: input.projectId })),
    ),
    deleteProject: vi.fn(() => Promise.resolve({ ok: true as const })),
    listBoards: vi.fn(() => Promise.resolve([board])),
    createBoard: vi.fn((input: { projectId: string; title: string }) =>
      Promise.resolve(fakeBoard({ id: 'b2', ...input })),
    ),
    renameBoard: vi.fn((input: { boardId: string; title: string }) =>
      Promise.resolve(fakeBoard({ id: input.boardId, title: input.title })),
    ),
    moveBoard: vi.fn((input: { boardId: string; projectId: string }) =>
      Promise.resolve(fakeBoard({ id: input.boardId, projectId: input.projectId })),
    ),
    archiveBoard: vi.fn((input: { boardId: string }) =>
      Promise.resolve(fakeBoard({ id: input.boardId, archivedAt: '2026-02-01T00:00:00.000Z' })),
    ),
    restoreBoard: vi.fn((input: { boardId: string }) =>
      Promise.resolve(fakeBoard({ id: input.boardId })),
    ),
    deleteBoard: vi.fn(() => Promise.resolve({ ok: true as const })),
    duplicateBoard: vi.fn((input: { boardId: string }) =>
      Promise.resolve(fakeBoard({ id: 'b3', templateOf: input.boardId })),
    ),
    saveBoardAsTemplate: vi.fn((input: { boardId: string }) =>
      Promise.resolve(fakeBoard({ id: input.boardId, isTemplate: true })),
    ),
    touchBoardOpened: vi.fn(() => Promise.resolve()),
    reportBoardCounts: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}
