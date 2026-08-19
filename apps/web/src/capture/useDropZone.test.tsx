/**
 * P6 §5.5/§5.6 — drop capture and the overlay it drives: files, a dragged link, and the case where
 * a drop carries nothing readable (the analyst still gets a sentence, not silence).
 */

import { createBoardDoc, createBoardHistory, listNodes } from '@nexus/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { summarizeDrag, useDropZone } from './useDropZone.ts';
import type { CaptureResult } from './usePaste.ts';

const T0 = '2026-08-17T12:00:00.000Z';

const board = () => {
  const doc = createBoardDoc({ boardId: 'b_drop', now: T0 });
  return { doc, history: createBoardHistory(doc), aim: () => ({ x: 0, y: 0 }), now: () => T0 };
};

const transfer = (over: Record<string, unknown>): DataTransfer =>
  ({ items: [], files: [], types: [], getData: () => '', ...over }) as unknown as DataTransfer;

function Harness({
  target,
  onResult,
}: {
  target: ReturnType<typeof board>;
  onResult: (r: CaptureResult) => void;
}) {
  const zone = useDropZone(target, onResult);
  return (
    <div data-testid="zone" {...zone.handlers}>
      {zone.state.active ? (
        <span data-testid="overlay">Drop to add {zone.state.summary}</span>
      ) : null}
    </div>
  );
}

describe('summarizeDrag', () => {
  it('counts files and names images', () => {
    expect(
      summarizeDrag(
        transfer({
          items: [
            { kind: 'file', type: 'image/png' },
            { kind: 'file', type: 'image/jpeg' },
          ],
        }),
      ),
    ).toBe('2 images');
    expect(summarizeDrag(transfer({ items: [{ kind: 'file', type: 'application/pdf' }] }))).toBe(
      '1 file',
    );
  });

  it('names a link, text and the unknown case', () => {
    expect(summarizeDrag(transfer({ types: ['text/uri-list'] }))).toBe('Link');
    expect(summarizeDrag(transfer({ types: ['text/plain'] }))).toBe('Text');
    expect(summarizeDrag(transfer({ types: [] }))).toBe('Item');
    expect(summarizeDrag(null)).toBe('Item');
  });
});

describe('useDropZone', () => {
  it('shows the overlay while dragging and hides it on leave', () => {
    render(<Harness target={board()} onResult={vi.fn()} />);
    const zone = screen.getByTestId('zone');
    fireEvent.dragOver(zone, { dataTransfer: transfer({ types: ['text/uri-list'] }) });
    expect(screen.getByTestId('overlay').textContent).toBe('Drop to add Link');
    fireEvent.dragLeave(zone, { dataTransfer: transfer({}) });
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('creates a node from a dropped link with drop provenance', () => {
    const target = board();
    const onResult = vi.fn<(result: CaptureResult) => void>();
    render(<Harness target={target} onResult={onResult} />);
    fireEvent.drop(screen.getByTestId('zone'), {
      dataTransfer: transfer({
        types: ['text/uri-list'],
        getData: (type: string) => (type === 'text/uri-list' ? 'https://a.example/' : ''),
      }),
    });
    expect(listNodes(target.doc)).toHaveLength(1);
    expect(listNodes(target.doc)[0]?.provenance.kind).toBe('drop');
    expect(onResult.mock.calls[0]?.[0].message).toBe('Added 1 link');
  });

  it('explains a drop it cannot read instead of doing nothing', () => {
    const target = board();
    const onResult = vi.fn<(result: CaptureResult) => void>();
    render(<Harness target={target} onResult={onResult} />);
    fireEvent.drop(screen.getByTestId('zone'), { dataTransfer: transfer({}) });
    expect(listNodes(target.doc)).toHaveLength(0);
    expect(onResult.mock.calls[0]?.[0].message).toContain('nothing we could read');
  });
});
