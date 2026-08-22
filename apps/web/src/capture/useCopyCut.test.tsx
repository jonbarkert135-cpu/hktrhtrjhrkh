/**
 * Roadmap §18 — copy/cut of a canvas selection and pasting it back as a subgraph.
 */

import {
  addEdge,
  addNode,
  createBoardDoc,
  createBoardHistory,
  listEdges,
  listNodes,
  makeEdge,
  makeNode,
  parseClip,
} from '@nexus/domain';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCopyCut } from './useCopyCut.ts';
import { captureTransfer } from './usePaste.ts';

const T0 = '2026-08-17T12:00:00.000Z';

function board() {
  const doc = createBoardDoc({ boardId: 'b_clip', now: T0 });
  const opts = { origin: 'local:create' as const, now: T0 };
  addNode(doc, makeNode({ id: 'n1', type: 'note', x: 0, y: 0, title: 'A' }, T0), opts);
  addNode(doc, makeNode({ id: 'n2', type: 'note', x: 100, y: 50, title: 'B' }, T0), opts);
  addEdge(doc, makeEdge({ id: 'e1', from: 'n1', to: 'n2' }, T0), opts);
  return { doc, history: createBoardHistory(doc) };
}

/** Minimal clipboard event: jsdom does not implement `ClipboardEvent` with data. */
function clipboardEvent(type: 'copy' | 'cut'): {
  event: Event;
  written: Record<string, string>;
} {
  const written: Record<string, string> = {};
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { setData: (mime: string, value: string) => (written[mime] = value) },
  });
  return { event, written };
}

interface HarnessProps {
  doc: ReturnType<typeof board>['doc'];
  history: ReturnType<typeof board>['history'];
  ids: string[];
  onMessage?: ((message: string) => void) | undefined;
}

function Harness({ doc, history, ids, onMessage }: HarnessProps) {
  useCopyCut({ doc, history, selection: () => ids, now: () => T0 }, onMessage);
  return null;
}

describe('useCopyCut', () => {
  it('writes the selected subgraph to the clipboard on copy', () => {
    const { doc, history } = board();
    const onMessage = vi.fn((_message: string) => undefined);
    render(<Harness doc={doc} history={history} ids={['n1', 'n2']} onMessage={onMessage} />);

    const { event, written } = clipboardEvent('copy');
    window.dispatchEvent(event);

    const clip = parseClip(written['text/plain'] ?? '');
    expect(clip?.nodes.map((node) => node.id)).toEqual(['n1', 'n2']);
    expect(clip?.edges).toHaveLength(1);
    expect(listNodes(doc)).toHaveLength(2);
    expect(onMessage.mock.lastCall?.[0]).toBe('Copied 2 nodes and 1 connection');
    expect(event.defaultPrevented).toBe(true);
  });

  it('removes the selection on cut', () => {
    const { doc, history } = board();
    render(<Harness doc={doc} history={history} ids={['n1']} />);

    const { event, written } = clipboardEvent('cut');
    window.dispatchEvent(event);
    expect(parseClip(written['text/plain'] ?? '')?.nodes.map((node) => node.id)).toEqual(['n1']);
    expect(listNodes(doc).map((node) => node.id)).toEqual(['n2']);
    expect(listEdges(doc)).toHaveLength(0);
  });

  it('does nothing with an empty selection', () => {
    const { doc, history } = board();
    render(<Harness doc={doc} history={history} ids={[]} />);
    const { event, written } = clipboardEvent('copy');
    window.dispatchEvent(event);
    expect(written['text/plain']).toBeUndefined();
    expect(event.defaultPrevented).toBe(false);
  });

  it('pastes a clip back as a subgraph instead of as text', () => {
    const source = board();
    render(<Harness doc={source.doc} history={source.history} ids={['n1', 'n2']} />);
    const { event, written } = clipboardEvent('copy');
    window.dispatchEvent(event);

    const target = board();
    const result = captureTransfer(
      { doc: target.doc, history: target.history, aim: () => ({ x: 500, y: 500 }), now: () => T0 },
      { text: written['text/plain'] ?? '' },
      'paste',
    );

    expect(result.ids).toHaveLength(2);
    expect(result.message).toBe('Pasted 2 nodes');
    expect(listNodes(target.doc)).toHaveLength(4);
    expect(listEdges(target.doc)).toHaveLength(2);
    const pasted = listNodes(target.doc).filter((node) => result.ids.includes(node.id));
    expect(Math.min(...pasted.map((node) => node.x))).toBe(500);
  });
});
