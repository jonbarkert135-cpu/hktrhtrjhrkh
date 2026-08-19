/** Right-click menu on a relationship (P5 §6). */

import { addEdge, createBoardDoc, createNode, getEdge, listEdges, makeEdge } from '@nexus/domain';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';

import { ConnectionOverlay } from './ConnectionOverlay.tsx';
import { EdgeContextMenu } from './EdgeContextMenu.tsx';

const T0 = '2026-06-01T00:00:00.000Z';

function board(): Y.Doc {
  const doc = createBoardDoc({ boardId: 'b_edge_menu', now: T0 });
  let counter = 0;
  const make = (): string =>
    createNode(
      doc,
      { type: 'note', x: 0, y: 0, title: 'n' },
      { now: T0, makeId: () => `n_${String(++counter)}` },
    ).node.id;
  addEdge(doc, makeEdge({ id: 'e_1', from: make(), to: make(), type: 'references' }, T0), {
    origin: 'local:create',
    now: T0,
  });
  return doc;
}

const menu = (over: Partial<React.ComponentProps<typeof EdgeContextMenu>> = {}) => {
  const doc = board();
  const onClose = over.onClose ?? vi.fn();
  render(
    <EdgeContextMenu
      doc={doc}
      edgeId="e_1"
      context={{ doc, now: () => T0 }}
      at={{ x: 20, y: 30 }}
      {...over}
      onClose={onClose}
    />,
  );
  return { doc, onClose };
};

describe('EdgeContextMenu', () => {
  it('opens at the click point with focus inside', () => {
    menu();
    const element = screen.getByTestId('edge-context-menu');
    expect(element).toHaveStyle({ position: 'fixed' });
    expect(element.contains(document.activeElement)).toBe(true);
  });

  it('changes the routing and closes', async () => {
    const { doc, onClose } = menu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Route: orthogonal' }));
    await waitFor(() => expect(getEdge(doc, 'e_1')?.style.routing).toBe('orthogonal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('reverses and deletes from the menu', async () => {
    const { doc } = menu();
    const before = getEdge(doc, 'e_1');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reverse direction' }));
    await waitFor(() => expect(getEdge(doc, 'e_1')?.source.nodeId).toBe(before?.target.nodeId));
  });

  it('deletes the relationship', async () => {
    const { doc } = menu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(listEdges(doc)).toHaveLength(0));
  });

  it('hands label editing back to the board and closes on Escape', async () => {
    const onEditLabel = vi.fn();
    const onClose = vi.fn();
    menu({ onEditLabel, onClose });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add label' }));
    expect(onEditLabel).toHaveBeenCalledWith('e_1');

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ConnectionOverlay', () => {
  const drop = { from: 'n_1', at: { x: 40, y: 50 }, screen: { x: 10, y: 12 } };

  it('renders nothing until a connection is dropped on empty canvas', () => {
    render(<ConnectionOverlay drop={null} onCreate={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByTestId('connection-quick-menu')).toBeNull();
  });

  it('offers the note, and cancels on Escape without creating anything', async () => {
    const onCreate = vi.fn();
    const onCancel = vi.fn();
    render(<ConnectionOverlay drop={drop} onCreate={onCreate} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'New note here and connect' }));
    expect(onCreate).toHaveBeenCalledWith(drop);
  });
});
