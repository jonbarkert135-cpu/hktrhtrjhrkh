/** The relationship inspector (P5 §5.11): every control writes to the document. */

import {
  addEdge,
  createBoardDoc,
  createNode,
  getEdge,
  listEdges,
  makeEdge,
  updateEdge,
} from '@nexus/domain';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';

import { EdgeInspector } from './EdgeInspector.tsx';

const T0 = '2026-06-01T00:00:00.000Z';

function board(): { doc: Y.Doc } {
  const doc = createBoardDoc({ boardId: 'b_edge_panel', now: T0 });
  let counter = 0;
  const make = (title: string): string =>
    createNode(
      doc,
      { type: 'note', x: 0, y: 0, title },
      { now: T0, makeId: () => `n_${String(++counter)}` },
    ).node.id;
  const a = make('Alpha');
  const b = make('Beta');
  addEdge(doc, makeEdge({ id: 'e_1', from: a, to: b, type: 'references' }, T0), {
    origin: 'local:create',
    now: T0,
  });
  return { doc };
}

const panel = (over: Partial<React.ComponentProps<typeof EdgeInspector>> = {}) => {
  const { doc } = board();
  render(
    <EdgeInspector
      doc={doc}
      edgeId="e_1"
      context={{ doc, now: () => T0 }}
      endpoints={{ source: 'Alpha', target: 'Beta' }}
      {...over}
    />,
  );
  return { doc };
};

describe('EdgeInspector', () => {
  it('reads the relationship in both directions', () => {
    panel();
    expect(screen.getByTestId('edge-reading')).toHaveTextContent('Alpha references Beta');
    expect(screen.getByText(/Reads backwards/)).toHaveTextContent('Beta referenced by Alpha');
  });

  it('changes the type through the picker', async () => {
    const { doc } = panel();
    await userEvent.selectOptions(screen.getByLabelText('Relationship type'), 'same_as');
    await waitFor(() => expect(getEdge(doc, 'e_1')?.type).toBe('same_as'));
  });

  it('commits the label on blur and the routing immediately', async () => {
    const { doc } = panel();
    await userEvent.type(screen.getByLabelText('Label'), 'cites');
    await userEvent.tab();
    await waitFor(() => expect(getEdge(doc, 'e_1')?.label).toBe('cites'));

    await userEvent.selectOptions(screen.getByLabelText('Routing'), 'orthogonal');
    await waitFor(() => expect(getEdge(doc, 'e_1')?.style.routing).toBe('orthogonal'));
  });

  it('reverses and deletes, telling the board when the relationship is gone', async () => {
    const onDeleted = vi.fn();
    const { doc } = panel({ onDeleted });
    const before = getEdge(doc, 'e_1');
    await userEvent.click(screen.getByRole('button', { name: 'Reverse direction' }));
    await waitFor(() => expect(getEdge(doc, 'e_1')?.source.nodeId).toBe(before?.target.nodeId));

    await userEvent.click(screen.getByRole('button', { name: 'Delete relationship' }));
    await waitFor(() => expect(listEdges(doc)).toHaveLength(0));
    expect(onDeleted).toHaveBeenCalledWith('e_1');
    expect(screen.getByText('Relationship deleted')).toBeInTheDocument();
  });

  it('shows the refusal message instead of silently ignoring a duplicate', async () => {
    const { doc } = panel();
    const edge = getEdge(doc, 'e_1');
    addEdge(
      doc,
      makeEdge(
        { id: 'e_2', from: edge?.source.nodeId ?? '', to: edge?.target.nodeId ?? '', type: 'owns' },
        T0,
      ),
      { origin: 'local:create', now: T0 },
    );
    await userEvent.selectOptions(screen.getByLabelText('Relationship type'), 'owns');
    expect(await screen.findByRole('status')).toHaveTextContent(/already connected/i);
    expect(getEdge(doc, 'e_1')?.type).toBe('references');
  });

  it('teaches the waypoint gestures while there are none', () => {
    panel();
    expect(screen.getByTestId('edge-waypoints')).toHaveTextContent(/Double-click the line/i);
    expect(screen.queryByRole('button', { name: 'Reset routing' })).not.toBeInTheDocument();
  });

  it('flags a waypoint dropped inside a card, and resets the routing', async () => {
    const { doc } = board();
    // Both cards sit at 0,0 sized by the note default, so this waypoint is inside one of them.
    updateEdge(doc, 'e_1', { waypoints: [{ x: 10, y: 10 }] }, { origin: 'local:edit', now: T0 });
    render(<EdgeInspector doc={doc} edgeId="e_1" context={{ doc, now: () => T0 }} />);
    expect(screen.getByTestId('edge-waypoints-warning')).toHaveTextContent(/inside a card/i);

    await userEvent.click(screen.getByRole('button', { name: 'Reset routing' }));
    await waitFor(() => expect(getEdge(doc, 'e_1')?.waypoints).toEqual([]));
  });
});
