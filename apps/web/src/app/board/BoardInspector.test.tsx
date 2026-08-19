/** Which inspector the board shows for a given selection (P5 §5.11). */

import { addEdge, createBoardDoc, createNode, makeEdge } from '@nexus/domain';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';

import { createNodeStore, type NodeStore } from '../../nodes/nodeStore.ts';
import { BoardInspector } from './BoardInspector.tsx';

const T0 = '2026-06-01T00:00:00.000Z';

function board(): { doc: Y.Doc; store: NodeStore; nodeIds: string[] } {
  const doc = createBoardDoc({ boardId: 'b_inspector_switch', now: T0 });
  const nodeIds: string[] = [];
  let counter = 0;
  const make = (title: string): string => {
    const { node } = createNode(
      doc,
      { type: 'note', x: 0, y: 0, title },
      { now: T0, makeId: () => `n_${String(++counter)}` },
    );
    nodeIds.push(node.id);
    return node.id;
  };
  addEdge(doc, makeEdge({ id: 'e_1', from: make('Alpha'), to: make('Beta') }, T0), {
    origin: 'local:create',
    now: T0,
  });
  return { doc, store: createNodeStore(doc), nodeIds };
}

const view = (selectedIds: readonly string[]) => {
  const { doc, store, nodeIds } = board();
  render(
    <BoardInspector
      doc={doc}
      store={store}
      selectedIds={selectedIds}
      context={{ doc, now: () => T0 }}
      width={360}
      onWidthChange={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return { doc, nodeIds };
};

describe('BoardInspector', () => {
  it('shows the node inspector for an empty or node selection', () => {
    view([]);
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
    expect(screen.queryByTestId('edge-inspector')).toBeNull();
  });

  it('shows the relationship inspector for a single selected edge, with both endpoint titles', () => {
    view(['e_1']);
    expect(screen.getByTestId('edge-inspector')).toBeInTheDocument();
    expect(screen.getByTestId('edge-reading')).toHaveTextContent('Alpha related to Beta');
  });

  it('falls back to the node inspector when an edge is selected together with a node', () => {
    const { nodeIds } = board();
    render(
      <BoardInspector
        doc={board().doc}
        store={board().store}
        selectedIds={['e_1', nodeIds[0] ?? '']}
        context={{ doc: board().doc, now: () => T0 }}
        width={360}
        onWidthChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
  });
});
