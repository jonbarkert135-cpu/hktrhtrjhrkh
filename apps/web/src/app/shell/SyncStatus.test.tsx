import { createBoardDoc, createBoardHistory, addNode, makeNode } from '@nexus/domain';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { initialSyncStatus, type SyncStatus as Status } from '../../data/syncStatus';
import { SyncStatus } from './SyncStatus';

const NOW = '2026-08-17T12:00:00.000Z';
const T = 1_800_000_000_000;

function setup(status: Partial<Status> = {}) {
  const doc = createBoardDoc({ boardId: 'b_ui', now: NOW });
  const history = createBoardHistory(doc, { captureTimeout: 0 });
  const onRetry = vi.fn();
  const onExport = vi.fn();
  const view = render(
    <SyncStatus
      status={{ ...initialSyncStatus(), ...status }}
      history={history}
      now={T}
      onRetry={onRetry}
      onExport={onExport}
    />,
  );
  return { doc, history, onRetry, onExport, view };
}

describe('<SyncStatus>', () => {
  it('shows the current state and the age of the last save', () => {
    setup({ state: 'saved', lastSavedAt: T - 3_000 });
    const indicator = screen.getByTestId('sync-status');
    expect(indicator).toHaveTextContent('Saved');
    expect(indicator).toHaveAttribute('title', 'Saved locally 3 s ago');
  });

  it('disables undo and redo until there is something to undo', () => {
    const { doc, history } = setup();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();

    act(() => {
      history.label('create 1 node');
      addNode(doc, makeNode({ id: 'n1', x: 0, y: 0 }, NOW), { origin: 'local:create', now: NOW });
    });

    const undo = screen.getByRole('button', { name: 'Undo: create 1 node' });
    expect(undo).toBeEnabled();
    act(() => {
      fireEvent.click(undo);
    });
    expect(screen.getByRole('button', { name: 'Redo: create 1 node' })).toBeEnabled();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Redo: create 1 node' }));
    });
    expect(screen.getByRole('button', { name: /^Undo/ })).toBeEnabled();
  });

  it('offers retry and export when persistence failed', () => {
    const { onRetry, onExport } = setup({
      state: 'error',
      error: { kind: 'quota', message: 'This device is out of storage.' },
    });
    expect(screen.getByTestId('sync-status')).toHaveTextContent('Not saved');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export to file' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledOnce();
  });

  it('has no retry affordance while everything is fine', () => {
    setup({ state: 'offline' });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByTestId('sync-status')).toHaveTextContent('Offline');
  });
});
