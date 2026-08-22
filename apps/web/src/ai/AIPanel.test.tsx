/**
 * Roadmap §16 — the AI panel previews, never writes on its own.
 */

import { addNode, createBoardDoc, listEdges, makeNode } from '@nexus/domain';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AIPanel } from './AIPanel.tsx';
import { runAIOnDoc } from './runOnDoc.ts';

const NOW = '2026-08-22T10:00:00.000Z';

function board() {
  const doc = createBoardDoc({ boardId: 'b_ai', now: NOW });
  for (const id of ['n1', 'n2']) {
    addNode(
      doc,
      makeNode({ id, type: 'note', x: 0, y: 0, title: 'Acme Corporation', tags: ['osint'] }, NOW),
      { origin: 'local:create', now: NOW },
    );
  }
  return doc;
}

describe('runAIOnDoc', () => {
  it('runs a deterministic capability with no endpoint configured', async () => {
    const result = await runAIOnDoc(board(), 'find-duplicates', { boardId: 'b_ai' });
    expect(result.proposal?.items).toHaveLength(1);
    expect(result.model).toBe('none');
  });

  it('refuses a model capability instead of pretending', async () => {
    await expect(runAIOnDoc(board(), 'summarize-node', { boardId: 'b_ai' })).rejects.toThrow(
      /AI endpoint/,
    );
  });
});

describe('AIPanel', () => {
  it('shows the explanation and leaves the board untouched until the user applies', async () => {
    const doc = board();
    const user = userEvent.setup();
    render(
      <AIPanel
        open
        onClose={vi.fn()}
        doc={doc}
        boardId="b_ai"
        selectedIds={['n1', 'n2']}
        onUndo={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'suggest-connections' }));
    expect(await screen.findByTestId('ai-explanation')).toHaveTextContent('nothing is written');
    expect(listEdges(doc)).toHaveLength(0);

    await user.click(screen.getByRole('checkbox', { name: /related_to/ }));
    await user.click(screen.getByRole('button', { name: /Apply/ }));
    expect(listEdges(doc)).toHaveLength(1);
    expect(await screen.findByRole('status')).toHaveTextContent('1 edge(s)');
  });

  it('only offers the keyless capabilities without an endpoint', () => {
    render(
      <AIPanel
        open
        onClose={vi.fn()}
        doc={board()}
        boardId="b_ai"
        selectedIds={[]}
        onUndo={vi.fn()}
      />,
    );
    expect(screen.getByText(/No AI endpoint is configured/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'summarize-node' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cluster-nodes' })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <AIPanel
        open={false}
        onClose={vi.fn()}
        doc={board()}
        boardId="b_ai"
        selectedIds={[]}
        onUndo={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
