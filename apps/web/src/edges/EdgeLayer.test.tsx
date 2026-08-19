/** The relationship layer: intent routing, endpoint titles, and which menu opens (P5 §5.3, §6). */

import type { Intent } from '@nexus/canvas-engine';
import { addEdge, createBoardDoc, createNode, listEdges, makeEdge } from '@nexus/domain';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';

import {
  EdgeLayer,
  endpointTitles,
  pendingFromIntent,
  selectedEdgeOf,
  type PendingEdgeUi,
} from './EdgeLayer.tsx';

const T0 = '2026-06-01T00:00:00.000Z';

function board(): { doc: Y.Doc; nodeIds: string[] } {
  const doc = createBoardDoc({ boardId: 'b_edge_layer', now: T0 });
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
  return { doc, nodeIds };
}

const screenOf = (world: { x: number; y: number }) => ({ x: world.x * 2, y: world.y * 2 });

const layer = (
  pending: PendingEdgeUi | null,
  over: Partial<React.ComponentProps<typeof EdgeLayer>> = {},
) => {
  const { doc, nodeIds } = board();
  const props = {
    doc,
    context: { doc, now: () => T0 },
    pending,
    screenOf,
    onClose: vi.fn(),
    onConnectToEmpty: vi.fn(),
    ...over,
  };
  render(<EdgeLayer {...props} />);
  return { doc, nodeIds, props };
};

describe('pendingFromIntent', () => {
  it('claims the edge context menu and the empty-canvas drop, and nothing else', () => {
    const contextMenu: Intent = {
      t: 'context-menu',
      at: { x: 5, y: 6 },
      target: { t: 'edge', id: 'e_1' },
    };
    expect(pendingFromIntent(contextMenu)).toEqual({
      kind: 'edge',
      id: 'e_1',
      world: { x: 5, y: 6 },
    });

    const drop: Intent = {
      t: 'connect-to-empty',
      from: 'n_1',
      fromAnchor: { side: 'auto', t: 0.5 },
      at: { x: 9, y: 9 },
    };
    expect(pendingFromIntent(drop)).toEqual({ kind: 'drop', id: 'n_1', world: { x: 9, y: 9 } });

    const onNode: Intent = {
      t: 'context-menu',
      at: { x: 0, y: 0 },
      target: { t: 'node', id: 'a' },
    };
    expect(pendingFromIntent(onNode)).toBeNull();
    expect(pendingFromIntent({ t: 'delete', ids: ['e_1'] })).toBeNull();
  });
});

describe('endpointTitles and selectedEdgeOf', () => {
  it('reads both endpoint titles and reports a missing relationship', () => {
    const { doc } = board();
    expect(endpointTitles(doc, 'e_1')).toEqual({ source: 'Alpha', target: 'Beta' });
    expect(endpointTitles(doc, 'nope')).toBeUndefined();
  });

  it('only treats a single selected edge as the relationship selection', () => {
    const { doc, nodeIds } = board();
    expect(selectedEdgeOf(doc, ['e_1'])).toBe('e_1');
    expect(selectedEdgeOf(doc, [nodeIds[0] ?? ''])).toBeNull();
    expect(selectedEdgeOf(doc, ['e_1', nodeIds[0] ?? ''])).toBeNull();
    expect(selectedEdgeOf(doc, [])).toBeNull();
  });
});

describe('EdgeLayer', () => {
  it('renders nothing when no menu is pending', () => {
    layer(null);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the context menu at the converted screen point', () => {
    layer({ kind: 'edge', id: 'e_1', world: { x: 10, y: 20 } });
    const menu = screen.getByTestId('edge-context-menu');
    expect(menu).toHaveStyle({ insetInlineStart: '20px', insetBlockStart: '40px' });
  });

  it('renders no menu for a relationship that is already gone', () => {
    const { doc } = layer({ kind: 'edge', id: 'e_gone', world: { x: 0, y: 0 } });
    expect(listEdges(doc)).toHaveLength(1);
    expect(screen.queryByTestId('edge-context-menu')).toBeNull();
  });

  it('offers the quick menu on a drop and reports the choice in world coordinates', async () => {
    const onConnectToEmpty = vi.fn();
    layer({ kind: 'drop', id: 'n_1', world: { x: 7, y: 8 } }, { onConnectToEmpty });
    await userEvent.click(screen.getByRole('button', { name: 'New note here and connect' }));
    expect(onConnectToEmpty).toHaveBeenCalledWith('n_1', { x: 7, y: 8 });
  });

  it('closes the quick menu on cancel', async () => {
    const onClose = vi.fn();
    layer({ kind: 'drop', id: 'n_1', world: { x: 7, y: 8 } }, { onClose });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
