import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceProvider } from '../../data/workspace/context';
import { fakeBoard, fakeProject, fakeWorkspaceRepository } from '../../data/workspace/testFakes';
import { WorkspaceError, type WorkspaceRepository } from '../../data/workspace/types';
import { ShellContainer } from './ShellContainer';

let repository: WorkspaceRepository;

const base = (): WorkspaceRepository =>
  fakeWorkspaceRepository({
    listProjects: vi.fn(() => Promise.resolve([])),
    createProject: vi.fn((input: { name: string }) =>
      Promise.resolve(fakeProject({ id: 'p-new', name: input.name })),
    ),
    listBoards: vi.fn(() => Promise.resolve([])),
    createBoard: vi.fn((input: { projectId: string; title: string; id?: string | undefined }) =>
      Promise.resolve(
        fakeBoard({ id: input.id ?? 'b-new', projectId: input.projectId, title: input.title }),
      ),
    ),
  });

beforeEach(() => {
  repository = base();
});

function renderContainer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider repository={repository}>
        <MemoryRouter>
          <Routes>
            <Route
              path="/"
              element={
                <ShellContainer>
                  <p>board</p>
                </ShellContainer>
              }
            />
            <Route path="/p/:projectId" element={<p>project page</p>} />
          </Routes>
        </MemoryRouter>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

describe('ShellContainer', () => {
  it('seeds a first project holding the scratch board in local mode', async () => {
    renderContainer();
    await waitFor(() =>
      expect(repository.createBoard).toHaveBeenCalledWith({
        projectId: 'p-new',
        title: 'Untitled board',
        id: 'scratch',
      }),
    );
  });

  it('renders the empty state and creates a project from the dialog', async () => {
    renderContainer();
    await userEvent.click(
      await screen.findByRole('button', { name: /create your first project/i }),
    );
    await userEvent.type(await screen.findByLabelText(/name/i), 'Atlas');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(repository.createProject).toHaveBeenCalledWith({ name: 'Atlas' }));
  });

  it('refreshes the rail and routes to the new project', async () => {
    renderContainer();
    await userEvent.click(
      await screen.findByRole('button', { name: /create your first project/i }),
    );
    await userEvent.type(await screen.findByLabelText(/name/i), 'Atlas');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(screen.getByText('project page')).toBeInTheDocument());
    // At least the initial read and the post-create refresh; local-mode bootstrap reads too.
    expect((repository.listProjects as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      1,
    );
  });

  it('lists the projects it read', async () => {
    repository.listProjects = vi.fn(() =>
      Promise.resolve([fakeProject({ id: 'p1', name: 'Atlas' })]),
    );
    renderContainer();
    expect(await screen.findByRole('link', { name: 'Atlas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
  });

  it('shows skeletons while the rail is loading', () => {
    renderContainer();
    expect(screen.getByLabelText('Loading projects')).toBeInTheDocument();
  });

  it('maps a failed read to copy with a retry that reads again', async () => {
    const listProjects = vi
      .fn<() => Promise<never[]>>()
      .mockRejectedValueOnce(new WorkspaceError('This device is out of storage.'))
      .mockResolvedValue([]);
    repository.listProjects = listProjects;
    renderContainer();
    expect(await screen.findByText('This device is out of storage.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(listProjects.mock.calls.length).toBeGreaterThan(1));
  });
});
