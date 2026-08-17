import {
  createBoardDoc,
  addNode,
  exportBoard,
  makeNode,
  serializeBoardExport,
} from '@nexus/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImportDialog, readImportFile } from './ImportDialog';

const NOW = '2026-08-17T12:00:00.000Z';

function archiveJson(): string {
  const doc = createBoardDoc({ boardId: 'b_src', title: 'Case 42', now: NOW });
  addNode(doc, makeNode({ id: 'n1', x: 0, y: 0, title: 'One' }, NOW), {
    origin: 'local:create',
    now: NOW,
  });
  return serializeBoardExport(exportBoard(doc, { appVersion: '0.3.0', now: NOW }));
}

/** jsdom's File has no `text()`, so the picker's read path is stubbed per file. */
function fileWith(content: string): File {
  const file = new File([content], 'board.nexus.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  return file;
}

describe('readImportFile', () => {
  it('parses and validates an archive', () => {
    expect(readImportFile(archiveJson()).data.board.title).toBe('Case 42');
  });

  it('throws for anything else', () => {
    expect(() => readImportFile('{"format":"nope"}')).toThrow();
  });
});

describe('<ImportDialog>', () => {
  it('summarises what will be imported before the user confirms', async () => {
    const onConfirm = vi.fn();
    render(<ImportDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    fireEvent.change(screen.getByTestId('import-file'), {
      target: { files: [fileWith(archiveJson())] },
    });

    await waitFor(() => expect(screen.getByTestId('import-summary')).toBeInTheDocument());
    expect(screen.getByTestId('import-summary')).toHaveTextContent('1 nodes');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('reports an invalid file and imports nothing', async () => {
    const onConfirm = vi.fn();
    render(<ImportDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByTestId('import-file'), {
      target: { files: [fileWith('{"format":"nope"}')] },
    });
    await waitFor(() => expect(screen.getAllByText(/was not imported/).length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('announces that an older archive will be upgraded', async () => {
    const legacy = JSON.stringify({
      format: 'nexus.board.v0',
      board: { boardId: 'b_old', title: 'Legacy', createdAt: NOW, updatedAt: NOW },
      nodes: [
        {
          id: 'n_old',
          type: 'note',
          x: 0,
          y: 0,
          w: 280,
          h: 160,
          title: 'Old',
          createdAt: NOW,
          updatedAt: NOW,
          data: {},
        },
      ],
      edges: [],
      exportedAt: NOW,
    });
    render(<ImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [fileWith(legacy)] } });
    await waitFor(() => expect(screen.getByText(/older format/)).toBeInTheDocument());
  });

  it('does nothing when the picker is cleared', () => {
    render(<ImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [] } });
    expect(screen.queryByTestId('import-summary')).toBeNull();
  });
});
