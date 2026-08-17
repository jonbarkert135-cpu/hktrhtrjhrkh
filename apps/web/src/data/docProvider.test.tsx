import { addNode, listNodes, makeNode } from '@nexus/domain';
import { render, screen, waitFor } from '@testing-library/react';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardDocProvider, useBoardDoc, useHistoryState } from './docProvider';
import { createPersistence } from './persistence';
import type { SnapshotStore } from './snapshots';

const NOW = '2026-08-17T12:00:00.000Z';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
});

const snapshotStore: SnapshotStore = {
  save: () => Promise.resolve(),
  list: () => Promise.resolve([]),
  load: () => Promise.resolve(null),
  prune: () => Promise.resolve(0),
};

function Probe() {
  const { boardId, doc, ready, status, history, storageWarning } = useBoardDoc();
  const historyState = useHistoryState(history);
  return (
    <div>
      <span data-testid="board">{boardId}</span>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="state">{status.state}</span>
      <span data-testid="nodes">{String(listNodes(doc).length)}</span>
      <span data-testid="undo">{String(historyState.canUndo)}</span>
      <span data-testid="warning">{storageWarning ?? ''}</span>
      <button
        type="button"
        onClick={() =>
          addNode(doc, makeNode({ id: 'n1', x: 0, y: 0 }, NOW), {
            origin: 'local:create',
            now: NOW,
          })
        }
      >
        add
      </button>
    </div>
  );
}

describe('<BoardDocProvider>', () => {
  it('provides a document that becomes ready once storage is read', async () => {
    render(
      <BoardDocProvider boardId="b_ctx" snapshotStoreImpl={snapshotStore}>
        <Probe />
      </BoardDocProvider>,
    );
    expect(screen.getByTestId('board')).toHaveTextContent('b_ctx');
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));

    screen.getByRole('button', { name: 'add' }).click();
    await waitFor(() => expect(screen.getByTestId('nodes')).toHaveTextContent('1'));
    await waitFor(() => expect(screen.getByTestId('undo')).toHaveTextContent('true'));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('saved'));
  });

  it('surfaces a storage warning when OPFS is missing', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    render(
      <BoardDocProvider boardId="b_warn" snapshotStoreImpl={snapshotStore}>
        <Probe />
      </BoardDocProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('warning')).toHaveTextContent(/OPFS/));
    if (original) Object.defineProperty(globalThis, 'navigator', original);
  });

  it('tears the whole stack down on unmount', async () => {
    const destroy = vi.fn(() => Promise.resolve());
    const view = render(
      <BoardDocProvider
        boardId="b_teardown"
        snapshotStoreImpl={snapshotStore}
        createPersistenceImpl={(options) => {
          const handle = createPersistence(options);
          return { ...handle, destroy };
        }}
      >
        <Probe />
      </BoardDocProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    view.unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('refuses to be used outside the provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/must be used inside/);
    error.mockRestore();
  });
});
