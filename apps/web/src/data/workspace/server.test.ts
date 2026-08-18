import { describe, expect, it, vi } from 'vitest';

import { createServerWorkspaceRepository, type WorkspaceApi } from './server';
import { WorkspaceError } from './types';

const api = (overrides: Partial<WorkspaceApi> = {}): WorkspaceApi => ({
  listProjects: vi.fn(() =>
    Promise.resolve([{ id: 'p1', name: 'Atlas', createdAt: new Date('2026-01-02T03:04:05Z') }]),
  ),
  createProject: vi.fn((input: { name: string }) =>
    Promise.resolve({ id: 'p2', name: input.name, createdAt: '2026-01-03T00:00:00.000Z' }),
  ),
  listBoards: vi.fn(({ projectId }: { projectId: string }) =>
    Promise.resolve([
      { id: 'b1', projectId, title: 'Timeline', createdAt: new Date('2026-01-04T00:00:00Z') },
    ]),
  ),
  createBoard: vi.fn((input: { projectId: string; title: string }) =>
    Promise.resolve({ id: 'b2', ...input, createdAt: new Date('2026-01-05T00:00:00Z') }),
  ),
  ...overrides,
});

describe('server workspace repository', () => {
  it('presents API rows in the same shape the local implementation returns', async () => {
    const repository = createServerWorkspaceRepository(api());
    expect(repository.kind).toBe('server');
    await expect(repository.listProjects()).resolves.toEqual([
      { id: 'p1', name: 'Atlas', createdAt: '2026-01-02T03:04:05.000Z' },
    ]);
    await expect(repository.listBoards('p1')).resolves.toEqual([
      { id: 'b1', projectId: 'p1', title: 'Timeline', createdAt: '2026-01-04T00:00:00.000Z' },
    ]);
  });

  it('accepts a date that already arrived as a string (superjson off, plain JSON)', async () => {
    const repository = createServerWorkspaceRepository(api());
    await expect(repository.createProject({ name: 'Atlas' })).resolves.toMatchObject({
      createdAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('passes the project id through when creating a board', async () => {
    const client = api();
    const repository = createServerWorkspaceRepository(client);
    await repository.createBoard({ projectId: 'p9', title: 'New' });
    expect(client.createBoard).toHaveBeenCalledWith({ projectId: 'p9', title: 'New' });
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
