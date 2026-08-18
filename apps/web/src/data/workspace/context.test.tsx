import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { useBoards, useCreateBoard, useCreateProject, useProjects, useWorkspace } from './context';
import { WorkspaceProvider } from './context';
import { workspaceErrorMessage } from './errors';
import { WorkspaceError, type WorkspaceRepository } from './types';

function fakeRepository(overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository {
  const projects = [{ id: 'p1', name: 'Atlas', createdAt: '2026-01-01T00:00:00.000Z' }];
  const boards = [
    { id: 'b1', projectId: 'p1', title: 'Timeline', createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  return {
    kind: 'local',
    listProjects: vi.fn(() => Promise.resolve([...projects])),
    createProject: vi.fn((input: { name: string }) =>
      Promise.resolve({ id: 'p2', name: input.name, createdAt: '2026-01-02T00:00:00.000Z' }),
    ),
    listBoards: vi.fn(() => Promise.resolve([...boards])),
    createBoard: vi.fn((input: { projectId: string; title: string }) =>
      Promise.resolve({ id: 'b2', ...input, createdAt: '2026-01-02T00:00:00.000Z' }),
    ),
    ...overrides,
  };
}

function withRepository(repository: WorkspaceRepository, ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider repository={repository}>{ui}</WorkspaceProvider>
    </QueryClientProvider>,
  );
}

function Projects() {
  const query = useProjects();
  const create = useCreateProject(() => undefined);
  if (query.isPending) return <p>loading</p>;
  if (query.error) return <p>error: {workspaceErrorMessage(query.error)}</p>;
  return (
    <div>
      <ul>
        {(query.data ?? []).map((project) => (
          <li key={project.id}>{project.name}</li>
        ))}
      </ul>
      <button type="button" onClick={() => create.mutate({ name: 'Made' })}>
        create
      </button>
    </div>
  );
}

function Boards({ projectId }: { projectId: string }) {
  const boards = useBoards(projectId);
  const create = useCreateBoard(projectId, () => undefined);
  return (
    <div>
      <p>state: {boards.isPending ? 'pending' : 'ready'}</p>
      <ul>
        {(boards.data ?? []).map((board) => (
          <li key={board.id}>{board.title}</li>
        ))}
      </ul>
      <button type="button" onClick={() => create.mutate({ title: 'Made' })}>
        create board
      </button>
    </div>
  );
}

describe('workspace hooks', () => {
  it('reads projects through whichever repository is mounted', async () => {
    withRepository(fakeRepository(), <Projects />);
    expect(await screen.findByText('Atlas')).toBeInTheDocument();
  });

  it('refetches the list after a create, so the rail shows the new project', async () => {
    const repository = fakeRepository();
    withRepository(repository, <Projects />);
    await screen.findByText('Atlas');
    await userEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => {
      expect(repository.createProject).toHaveBeenCalledWith({ name: 'Made' });
      // Once for the mount, once because creating invalidated the query.
      expect(repository.listProjects).toHaveBeenCalledTimes(2);
    });
  });

  it('surfaces a local storage failure with its own copy', async () => {
    const repository = fakeRepository({
      listProjects: () => Promise.reject(new WorkspaceError('This device is out of storage.')),
    });
    withRepository(repository, <Projects />);
    expect(await screen.findByText('error: This device is out of storage.')).toBeInTheDocument();
  });

  it('does not query boards before a project id is known', () => {
    const repository = fakeRepository();
    withRepository(repository, <Boards projectId="" />);
    expect(repository.listBoards).not.toHaveBeenCalled();
  });

  it('creates a board against the project it was mounted for', async () => {
    const repository = fakeRepository();
    withRepository(repository, <Boards projectId="p1" />);
    expect(await screen.findByText('Timeline')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'create board' }));
    await waitFor(() => {
      expect(repository.createBoard).toHaveBeenCalledWith({ projectId: 'p1', title: 'Made' });
    });
  });

  it('fails loudly when a component is mounted outside the provider', () => {
    function Orphan() {
      useWorkspace();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Orphan />)).toThrow(/must be used inside a <WorkspaceProvider>/);
    spy.mockRestore();
  });
});

describe('workspaceErrorMessage', () => {
  it('keeps local copy verbatim and maps anything else through the tRPC table', () => {
    expect(workspaceErrorMessage(new WorkspaceError('Out of storage.'))).toBe('Out of storage.');
    expect(workspaceErrorMessage(new Error('boom'))).toMatch(/Try again/);
  });
});
