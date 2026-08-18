import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceProvider } from '../../data/workspace/context';
import { WorkspaceError, type WorkspaceRepository } from '../../data/workspace/types';
import ProjectPage from './ProjectPage';

const project = { id: 'p1', name: 'Atlas', createdAt: '2026-01-01T00:00:00.000Z' };

let repository: WorkspaceRepository;

const base = (): WorkspaceRepository => ({
  kind: 'local',
  listProjects: vi.fn(() => Promise.resolve([project])),
  createProject: vi.fn(() => Promise.reject(new Error('not used here'))),
  listBoards: vi.fn(() => Promise.resolve([])),
  createBoard: vi.fn((input: { projectId: string; title: string }) =>
    Promise.resolve({ id: 'b-new', ...input, createdAt: '2026-01-02T00:00:00.000Z' }),
  ),
});

beforeEach(() => {
  repository = base();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider repository={repository}>
        <MemoryRouter initialEntries={['/p/p1']}>
          <Routes>
            <Route path="/p/:projectId" element={<ProjectPage />} />
            <Route path="/b/:boardId" element={<p>canvas</p>} />
          </Routes>
        </MemoryRouter>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

describe('ProjectPage', () => {
  it('names the project and creates the first board', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Atlas' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /create your first board/i }));
    await userEvent.type(await screen.findByLabelText(/name/i), 'Sweep');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => {
      expect(repository.createBoard).toHaveBeenCalledWith({ projectId: 'p1', title: 'Sweep' });
    });
  });

  it('opens the new board once it exists', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Atlas' });
    await userEvent.click(screen.getByRole('button', { name: /create your first board/i }));
    await userEvent.type(await screen.findByLabelText(/name/i), 'Sweep');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(screen.getByText('canvas')).toBeInTheDocument());
  });

  it('links every existing board and offers another one', async () => {
    repository.listBoards = vi.fn(() =>
      Promise.resolve([
        { id: 'b1', projectId: 'p1', title: 'Sweep', createdAt: '2026-01-01T00:00:00.000Z' },
      ]),
    );
    renderPage();
    expect(await screen.findByRole('link', { name: 'Sweep' })).toHaveAttribute('href', '/b/b1');
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
  });

  it('shows a skeleton while either query is pending', () => {
    renderPage();
    expect(screen.getByLabelText('Loading project')).toBeInTheDocument();
  });

  it('maps a failed local read to copy the user can act on', async () => {
    repository.listBoards = vi.fn(() =>
      Promise.reject(new WorkspaceError('This device is out of storage.')),
    );
    renderPage();
    expect(await screen.findByText("Couldn't load this project")).toBeInTheDocument();
    expect(screen.getByText('This device is out of storage.')).toBeInTheDocument();
  });

  it('explains a project that is gone instead of rendering an empty page', async () => {
    repository.listProjects = vi.fn(() => Promise.resolve([]));
    renderPage();
    expect(await screen.findByText('That project no longer exists')).toBeInTheDocument();
  });
});
