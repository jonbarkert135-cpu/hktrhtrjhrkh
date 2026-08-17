import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const projectList = vi.fn();
const boardList = vi.fn();
const boardCreate = vi.fn();
const invalidate = vi.fn();

vi.mock('../../lib/trpc', () => ({
  errorMessage: () => 'The server took too long to answer.',
  trpc: {
    useUtils: () => ({ board: { list: { invalidate } } }),
    project: { list: { useQuery: (...args: unknown[]): unknown => projectList(...args) } },
    board: {
      list: { useQuery: (...args: unknown[]): unknown => boardList(...args) },
      create: { useMutation: (...args: unknown[]): unknown => boardCreate(...args) },
    },
  },
}));

const { default: ProjectPage } = await import('./ProjectPage');

const mutate = vi.fn();
let onSuccess: ((board: { id: string }) => Promise<void>) | undefined;

const project = { id: 'p1', name: 'Atlas' };

beforeEach(() => {
  vi.clearAllMocks();
  invalidate.mockResolvedValue(undefined);
  projectList.mockReturnValue({ isPending: false, error: null, data: [project] });
  boardList.mockReturnValue({ isPending: false, error: null, data: [] });
  boardCreate.mockImplementation((options: { onSuccess: (b: { id: string }) => Promise<void> }) => {
    onSuccess = options.onSuccess;
    return { mutate, isPending: false, error: null };
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/p/p1']}>
      <Routes>
        <Route path="/p/:projectId" element={<ProjectPage />} />
        <Route path="/b/:boardId" element={<p>canvas</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProjectPage', () => {
  it('names the project and creates the first board', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Atlas' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create your first board/i }));
    fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: 'Sweep' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(mutate).toHaveBeenCalledWith({ projectId: 'p1', title: 'Sweep' });
  });

  it('opens the new board once it exists', async () => {
    renderPage();
    await onSuccess?.({ id: 'b-new' });
    await waitFor(() => expect(screen.getByText('canvas')).toBeInTheDocument());
    expect(invalidate).toHaveBeenCalledWith({ projectId: 'p1' });
  });

  it('links every existing board and offers another one', () => {
    boardList.mockReturnValue({
      isPending: false,
      error: null,
      data: [{ id: 'b1', title: 'Sweep' }],
    });
    renderPage();
    expect(screen.getByRole('link', { name: 'Sweep' })).toHaveAttribute('href', '/b/b1');
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
  });

  it('shows a skeleton while either query is pending', () => {
    boardList.mockReturnValue({ isPending: true, error: null });
    renderPage();
    expect(screen.getByLabelText('Loading project')).toBeInTheDocument();
  });

  it('maps a failed query to copy', () => {
    boardList.mockReturnValue({ isPending: false, error: new Error('boom') });
    renderPage();
    expect(screen.getByText("Couldn't load this project")).toBeInTheDocument();
  });

  it('explains a project that is gone instead of rendering an empty page', () => {
    projectList.mockReturnValue({ isPending: false, error: null, data: [] });
    renderPage();
    expect(screen.getByText('That project no longer exists')).toBeInTheDocument();
  });
});
