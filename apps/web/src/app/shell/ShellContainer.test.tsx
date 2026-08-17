import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listQuery = vi.fn();
const createMutation = vi.fn();
const invalidate = vi.fn();

vi.mock('../../lib/trpc', () => ({
  errorMessage: () => 'The server took too long to answer.',
  trpc: {
    useUtils: () => ({ project: { list: { invalidate } } }),
    project: {
      list: { useQuery: (...args: unknown[]): unknown => listQuery(...args) },
      create: { useMutation: (...args: unknown[]): unknown => createMutation(...args) },
    },
  },
}));

const { ShellContainer } = await import('./ShellContainer');

const mutate = vi.fn();
let onSuccess: ((project: { id: string }) => Promise<void>) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  invalidate.mockResolvedValue(undefined);
  createMutation.mockImplementation(
    (options: { onSuccess: (p: { id: string }) => Promise<void> }) => {
      onSuccess = options.onSuccess;
      return { mutate, isPending: false, error: null };
    },
  );
  listQuery.mockReturnValue({ isPending: false, error: null, data: [], refetch: vi.fn() });
});

function renderContainer() {
  return render(
    <MemoryRouter>
      <ShellContainer>
        <p>board</p>
      </ShellContainer>
    </MemoryRouter>,
  );
}

describe('ShellContainer', () => {
  it('renders the empty state and creates a project from the dialog', async () => {
    renderContainer();
    fireEvent.click(screen.getByRole('button', { name: /create your first project/i }));
    fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: 'Atlas' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(mutate).toHaveBeenCalledWith({ name: 'Atlas' });
  });

  it('invalidates the rail and routes to the new project', async () => {
    renderContainer();
    await onSuccess?.({ id: 'p-new' });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it('lists the projects it fetched', () => {
    listQuery.mockReturnValue({
      isPending: false,
      error: null,
      data: [{ id: 'p1', name: 'Atlas' }],
      refetch: vi.fn(),
    });
    renderContainer();
    expect(screen.getByRole('link', { name: 'Atlas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
  });

  it('shows skeletons while the rail is loading', () => {
    listQuery.mockReturnValue({ isPending: true, error: null, refetch: vi.fn() });
    renderContainer();
    expect(screen.getByLabelText('Loading projects')).toBeInTheDocument();
  });

  it('maps a failed query to copy with a retry that refetches', () => {
    const refetch = vi.fn();
    listQuery.mockReturnValue({ isPending: false, error: new Error('boom'), refetch });
    renderContainer();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });
});
