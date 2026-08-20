import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceProvider } from '../data/workspace/context';
import { fakeBoard, fakeWorkspaceRepository } from '../data/workspace/testFakes';
import type { WorkspaceRepository } from '../data/workspace/types';
import { commandRegistry } from '../app/commands/registry';
import { BoardCard } from './BoardCard';

function renderCard(repository: WorkspaceRepository) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider repository={repository}>
        <MemoryRouter>
          <ul>
            <BoardCard
              board={fakeBoard({ id: 'b1', title: 'Sweep' })}
              {...{ role: 'owner' as const }}
            />
          </ul>
        </MemoryRouter>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

describe('BoardCard', () => {
  it('registers a palette command for every enabled menu item (P7 §5.8)', async () => {
    const rename = vi.fn(() => Promise.resolve(fakeBoard({ id: 'b1', title: 'Sweep 2' })));
    renderCard(fakeWorkspaceRepository({ renameBoard: rename }));

    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Save as template' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();

    for (const action of ['rename', 'duplicate', 'save-as-template', 'archive', 'delete']) {
      expect(commandRegistry.get(`board:b1:${action}`)).toBeDefined();
    }
  });

  it('running the palette command opens the same rename dialog as the menu item', async () => {
    renderCard(fakeWorkspaceRepository());
    act(() => {
      void commandRegistry.get('board:b1:rename')?.run({
        role: 'owner',
        view: 'project',
        projectId: null,
        boardId: null,
        navigate: vi.fn(),
      });
    });
    expect(await screen.findByRole('heading', { name: 'Rename board' })).toBeInTheDocument();
  });

  it('disables every mutating control for a viewer and registers no mutating commands', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <WorkspaceProvider repository={fakeWorkspaceRepository()}>
          <MemoryRouter>
            <ul>
              <BoardCard
                board={fakeBoard({ id: 'b2', title: 'Locked' })}
                {...{ role: 'viewer' as const }}
              />
            </ul>
          </MemoryRouter>
        </WorkspaceProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('Viewers cannot change boards')).toBeInTheDocument();
    expect(commandRegistry.get('board:b2:rename')).toBeUndefined();
  });
});
