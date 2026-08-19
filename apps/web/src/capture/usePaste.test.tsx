/**
 * P6 §5.1–§5.4, §12.1/§12.6 — the browser side of capture: a paste event reaches the board as one
 * undoable transaction, and a paste into a text field is left alone.
 */

import { createBoardDoc, createBoardHistory, listNodes } from '@nexus/domain';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { captureTransfer, snapshotTransfer, usePaste, type CaptureResult } from './usePaste.ts';

const T0 = '2026-08-17T12:00:00.000Z';

const board = () => {
  const doc = createBoardDoc({ boardId: 'b_capture', now: T0 });
  return { doc, history: createBoardHistory(doc), aim: () => ({ x: 0, y: 0 }), now: () => T0 };
};

/** A `DataTransfer` stand-in: jsdom's has no writable `files`. */
const transfer = (data: Record<string, string>, files: File[] = []): DataTransfer =>
  ({
    files,
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? '',
  }) as unknown as DataTransfer;

describe('snapshotTransfer', () => {
  it('reads files, html, uri-list and plain text', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    expect(
      snapshotTransfer(
        transfer(
          { 'text/html': '<b>x</b>', 'text/uri-list': 'https://a.example/', 'text/plain': 'x' },
          [file],
        ),
      ),
    ).toEqual({
      files: [{ name: 'a.png', type: 'image/png', size: 1 }],
      html: '<b>x</b>',
      uriList: 'https://a.example/',
      text: 'x',
    });
  });

  it('is empty for no clipboard and survives a throwing getData', () => {
    expect(snapshotTransfer(null)).toEqual({});
    const hostile = {
      files: [],
      types: ['text/plain'],
      getData: () => {
        throw new Error('denied');
      },
    } as unknown as DataTransfer;
    expect(snapshotTransfer(hostile)).toEqual({});
  });
});

describe('captureTransfer', () => {
  it('creates 3 website nodes in one undo step with paste provenance', () => {
    const target = board();
    const result = captureTransfer(
      target,
      { text: 'https://a.example/\nhttps://b.example/\nhttps://c.example/' },
      'paste',
    );
    expect(result.ids).toHaveLength(3);
    expect(result.message).toBe('Added 3 links');
    expect(listNodes(target.doc)[0]?.provenance.kind).toBe('paste');
    target.history.undo();
    expect(listNodes(target.doc)).toHaveLength(0);
  });

  it('writes nothing for an empty payload', () => {
    const target = board();
    const result = captureTransfer(target, {}, 'paste');
    expect(result.ids).toEqual([]);
    expect(result.message).toBeNull();
    expect(listNodes(target.doc)).toHaveLength(0);
  });

  it('re-captures a capped paste as a single list note', () => {
    const target = board();
    const text = Array.from({ length: 60 }, (_, i) => `https://s${String(i)}.example/`).join('\n');
    const capped = captureTransfer(target, { text }, 'paste');
    expect(capped.ids).toHaveLength(50);
    expect(capped.overflow).toEqual({ total: 60, kept: 50 });

    target.history.undo();
    const asList = captureTransfer(target, capped.snapshot, 'paste', { asList: true });
    expect(asList.ids).toHaveLength(1);
    expect(listNodes(target.doc)).toHaveLength(1);
  });
});

function Harness({
  target,
  onResult,
}: {
  target: ReturnType<typeof board>;
  onResult: (r: CaptureResult) => void;
}) {
  usePaste(target, onResult);
  return <textarea data-testid="field" />;
}

describe('usePaste', () => {
  const paste = (data: DataTransfer, target?: EventTarget) => {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: DataTransfer;
    };
    Object.defineProperty(event, 'clipboardData', { value: data });
    if (target !== undefined) target.dispatchEvent(event);
    else window.dispatchEvent(event);
    return event;
  };

  it('captures a window paste and reports the result', () => {
    const target = board();
    const onResult = vi.fn<(result: CaptureResult) => void>();
    render(<Harness target={target} onResult={onResult} />);
    const event = paste(transfer({ 'text/plain': 'https://a.example/' }));
    expect(event.defaultPrevented).toBe(true);
    expect(listNodes(target.doc)).toHaveLength(1);
    expect(onResult.mock.calls[0]?.[0].message).toBe('Added 1 link');
  });

  it('says so when there is nothing to paste', () => {
    const target = board();
    const onResult = vi.fn<(result: CaptureResult) => void>();
    render(<Harness target={target} onResult={onResult} />);
    paste(transfer({}));
    expect(onResult.mock.calls[0]?.[0].message).toBe('Nothing to paste — the clipboard is empty.');
  });

  it('leaves a paste into a text field to the field', () => {
    const target = board();
    const onResult = vi.fn<(result: CaptureResult) => void>();
    const view = render(<Harness target={target} onResult={onResult} />);
    paste(transfer({ 'text/plain': 'https://a.example/' }), view.getByTestId('field'));
    expect(onResult).not.toHaveBeenCalled();
    expect(listNodes(target.doc)).toHaveLength(0);
  });

  it('detaches its listener on unmount', () => {
    const target = board();
    const onResult = vi.fn<(result: CaptureResult) => void>();
    render(<Harness target={target} onResult={onResult} />).unmount();
    paste(transfer({ 'text/plain': 'https://a.example/' }));
    expect(onResult).not.toHaveBeenCalled();
  });
});
