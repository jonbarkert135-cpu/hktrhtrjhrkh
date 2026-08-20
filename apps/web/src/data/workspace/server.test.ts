import { describe, expect, it, vi } from 'vitest';

import { createServerWorkspaceRepository, type WorkspaceApi } from './server';
import { WorkspaceError } from './types';

const projectRow = {
  id: 'p1',
  name: 'Atlas',
  color: null,
  icon: null,
  archivedAt: null,
  createdAt: new Date('2026-01-02T03:04:05Z'),
};
const boardRow = {
  id: 'b1',
  projectId: 'p1',
  title: 'Timeline',
  icon: null,
  templateOf: null,
  isTemplate: false,
  archivedAt: null,
  lastOpenedAt: null,
  nodeCount: 0,
  edgeCount: 0,
  createdAt: new Date('2026-01-04T00:00:00Z'),
};

const api = (overrides: Partial<WorkspaceApi> = {}): WorkspaceApi => ({
  listProjects: vi.fn(() => Promise.resolve([projectRow])),
  createProject: vi.fn((input: { name: string }) =>
    Promise.resolve({
      ...projectRow,
      id: 'p2',
      name: input.name,
      createdAt: '2026-01-03T00:00:00.000Z',
    }),
  ),
  renameProject: vi.fn((input: { projectId: string; name: string }) =>
    Promise.resolve({ ...projectRow, id: input.projectId, name: input.name }),
  ),
  setProjectAppearance: vi.fn((input: { projectId: string }) =>
    Promise.resolve({ ...projectRow, id: input.projectId, color: '--project-blue' }),
  ),
  archiveProject: vi.fn((input: { projectId: string }) =>
    Promise.resolve({ ...projectRow, id: input.projectId, archivedAt: new Date('2026-02-01') }),
  ),
  restoreProject: vi.fn((input: { projectId: string }) =>
    Promise.resolve({ ...projectRow, id: input.projectId }),
  ),
  deleteProject: vi.fn(() => Promise.resolve({ ok: true as const })),
  listBoards: vi.fn(({ projectId }: { projectId: string }) =>
    Promise.resolve([{ ...boardRow, projectId }]),
  ),
  createBoard: vi.fn((input: { projectId: string; title: string }) =>
    Promise.resolve({ ...boardRow, id: 'b2', ...input }),
  ),
  renameBoard: vi.fn((input: { boardId: string; title: string }) =>
    Promise.resolve({ ...boardRow, id: input.boardId, title: input.title }),
  ),
  moveBoard: vi.fn((input: { boardId: string; projectId: string }) =>
    Promise.resolve({ ...boardRow, id: input.boardId, projectId: input.projectId }),
  ),
  archiveBoard: vi.fn((input: { boardId: string }) =>
    Promise.resolve({ ...boardRow, id: input.boardId, archivedAt: new Date('2026-02-01') }),
  ),
  restoreBoard: vi.fn((input: { boardId: string }) =>
    Promise.resolve({ ...boardRow, id: input.boardId }),
  ),
  deleteBoard: vi.fn(() => Promise.resolve({ ok: true as const })),
  duplicateBoard: vi.fn((input: { boardId: string }) =>
    Promise.resolve({ ...boardRow, id: 'b3', templateOf: input.boardId }),
  ),
  saveBoardAsTemplate: vi.fn((input: { boardId: string }) =>
    Promise.resolve({ ...boardRow, id: input.boardId, isTemplate: true }),
  ),
  touchBoardOpened: vi.fn(() => Promise.resolve({ ok: true as const })),
  reportBoardCounts: vi.fn(() => Promise.resolve({ ok: true as const })),
  ...overrides,
});

describe('server workspace repository', () => {
  it('presents API rows in the same shape the local implementation returns', async () => {
    const repository = createServerWorkspaceRepository(api());
    expect(repository.kind).toBe('server');
    await expect(repository.listProjects()).resolves.toEqual([
      {
        id: 'p1',
        name: 'Atlas',
        color: null,
        icon: null,
        archivedAt: null,
        createdAt: '2026-01-02T03:04:05.000Z',
      },
    ]);
    await expect(repository.listBoards('p1')).resolves.toEqual([
      {
        id: 'b1',
        projectId: 'p1',
        title: 'Timeline',
        icon: null,
        templateOf: null,
        isTemplate: false,
        archivedAt: null,
        lastOpenedAt: null,
        nodeCount: 0,
        edgeCount: 0,
        createdAt: '2026-01-04T00:00:00.000Z',
      },
    ]);
  });

  it('defaults to the editor role until P9 wires a real session', () => {
    expect(createServerWorkspaceRepository(api()).role()).toBe('editor');
  });

  it('accepts an injected role getter (P7 §12 UX gating, not the security boundary)', () => {
    const repository = createServerWorkspaceRepository(api(), { role: () => 'viewer' });
    expect(repository.role()).toBe('viewer');
  });

  it('accepts a date that already arrived as a string (superjson off, plain JSON)', async () => {
    const repository = createServerWorkspaceRepository(api());
    await expect(repository.createProject({ name: 'Atlas' })).resolves.toMatchObject({
      createdAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('passes the project id through when creating a board, without a template id', async () => {
    const client = api();
    const repository = createServerWorkspaceRepository(client);
    await repository.createBoard({ projectId: 'p9', title: 'New' });
    expect(client.createBoard).toHaveBeenCalledWith({ projectId: 'p9', title: 'New' });
  });

  it('forwards a template id when duplicating from one', async () => {
    const client = api();
    const repository = createServerWorkspaceRepository(client);
    await repository.createBoard({
      projectId: 'p9',
      title: 'New',
      templateId: 'investigation-starter',
    });
    expect(client.createBoard).toHaveBeenCalledWith({
      projectId: 'p9',
      title: 'New',
      templateId: 'investigation-starter',
    });
  });

  it('turns an unreachable server into copy, not a transport error', async () => {
    const repository = createServerWorkspaceRepository(
      api({ listProjects: () => Promise.reject(new TypeError('Failed to fetch')) }),
    );
    await expect(repository.listProjects()).rejects.toThrow(WorkspaceError);
    await expect(repository.listProjects()).rejects.toThrow(/could not be reached/);
  });

  it('lets a tRPC error through untouched, so its code still maps to the right sentence', async () => {
    const trpcError = Object.assign(new Error('UNAUTHORIZED'), { name: 'TRPCClientError' });
    const repository = createServerWorkspaceRepository(
      api({ listProjects: () => Promise.reject(trpcError) }),
    );
    await expect(repository.listProjects()).rejects.toBe(trpcError);
  });
});
