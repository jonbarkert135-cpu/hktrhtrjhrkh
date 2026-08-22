/**
 * The Auto Arrange flow, from the surface an analyst touches down to the undo step it produces:
 * preview writes nothing, apply is one undo step, cancellation stops a run, and every state of the
 * panel is reachable (P14a; `18_TESTING.md` §16).
 */

import {
  addEdge,
  addNode,
  createBoardDoc,
  createBoardHistory,
  listNodes,
  makeEdge,
  makeNode,
} from '@nexus/domain';
import { proposeLayout } from '@nexus/layout';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';

import { applyLayoutDiff } from './applyLayout.ts';
import { AutoArrangePanel } from './AutoArrangePanel.tsx';
import { DEFAULT_OPTIONS, useAutoArrangeStore } from './autoArrangeStore.ts';
import { graphFromDoc } from './graphFromDoc.ts';
import { createLayoutRunner } from './runner.ts';

const NOW = '2026-08-17T12:00:00.000Z';
const ORIGIN = { origin: 'local:create' as const, now: NOW };

function board(nodeCount = 6): Y.Doc {
  const doc = createBoardDoc({ boardId: 'b1', title: 'Board', now: NOW });
  for (let i = 0; i < nodeCount; i += 1) {
    addNode(
      doc,
      makeNode({ id: `n${String(i)}`, x: i * 13, y: i * 7, title: `Node ${String(i)}` }, NOW),
      ORIGIN,
    );
  }
  for (let i = 1; i < nodeCount; i += 1) {
    addEdge(doc, makeEdge({ id: `e${String(i)}`, from: 'n0', to: `n${String(i)}` }, NOW), ORIGIN);
  }
  return doc;
}

beforeEach(() => {
  useAutoArrangeStore.setState({
    open: false,
    algorithm: 'hierarchical',
    scope: 'board',
    options: DEFAULT_OPTIONS,
    status: 'idle',
    progress: 0,
    diff: null,
    error: null,
  });
});

afterEach(cleanup);

describe('graphFromDoc', () => {
  it('maps nodes, edges, lock state and the observed-at fallback', () => {
    const doc = board(3);
    const graph = graphFromDoc(doc);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes[0]?.observedAt).toBe(NOW);
    expect(graph.nodes[0]?.pinned).toBe(false);
  });
});

describe('applyLayoutDiff', () => {
  it('writes every move in a single undo step', () => {
    const doc = board(8);
    const history = createBoardHistory(doc);
    const before = new Map(listNodes(doc).map((node) => [node.id, { x: node.x, y: node.y }]));
    const diff = proposeLayout(graphFromDoc(doc), { algorithm: 'hierarchical' });
    expect(diff.moves.length).toBeGreaterThan(1);

    const moved = applyLayoutDiff(doc, diff, NOW);
    expect(moved).toBe(diff.moves.length);
    expect(listNodes(doc).some((node) => node.x !== before.get(node.id)?.x)).toBe(true);

    history.undo();
    for (const node of listNodes(doc)) {
      expect({ x: node.x, y: node.y }).toEqual(before.get(node.id));
    }
    history.destroy();
  });

  it('writes nothing for an empty diff', () => {
    const doc = board(2);
    const versions = listNodes(doc).map((node) => node.version);
    applyLayoutDiff(
      doc,
      {
        algorithm: 'tree',
        seed: 1,
        moves: [],
        stats: {
          moved: 0,
          unchanged: 2,
          pinned: 0,
          bounds: { x: 0, y: 0, w: 0, h: 0 },
          overlaps: 0,
        },
      },
      NOW,
    );
    expect(listNodes(doc).map((node) => node.version)).toEqual(versions);
  });
});

describe('createLayoutRunner', () => {
  it('runs inline when the platform has no worker, and reports progress', async () => {
    const runner = createLayoutRunner(null);
    expect(runner.threaded).toBe(false);
    const seen: number[] = [];
    const diff = await runner.run(
      graphFromDoc(board(5)),
      { algorithm: 'tree' },
      { onProgress: (value) => seen.push(value) },
    );
    expect(diff?.moves.length).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);
    runner.dispose();
  });

  it('falls back to inline when the worker cannot be constructed', async () => {
    const runner = createLayoutRunner(() => {
      throw new Error('blocked by CSP');
    });
    expect(runner.threaded).toBe(false);
    await expect(
      runner.run(graphFromDoc(board(3)), { algorithm: 'radial' }),
    ).resolves.not.toBeNull();
    runner.dispose();
  });

  it('cancels a worker run and resolves with null', async () => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const posted: unknown[] = [];
    const fakeWorker = {
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        const set = listeners.get(type) ?? new Set();
        set.add(handler);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners.get(type)?.delete(handler);
      },
      postMessage: (message: unknown) => posted.push(message),
      terminate: vi.fn(),
    } as unknown as Worker;
    vi.stubGlobal('Worker', function FakeWorker() {
      return fakeWorker;
    });

    const runner = createLayoutRunner(() => fakeWorker);
    expect(runner.threaded).toBe(true);
    const pending = runner.run(graphFromDoc(board(4)), { algorithm: 'force' });
    expect(posted).toHaveLength(1);

    runner.cancel();
    await expect(pending).resolves.toBeNull();
    // The worker is told to stop, not just abandoned — a run left going costs a core.
    expect(posted[1]).toMatchObject({ kind: 'cancel' });
    runner.dispose();
    vi.unstubAllGlobals();
  });

  it('resolves a worker run with the diff it sends back', async () => {
    const handlers = new Set<(event: { data: unknown }) => void>();
    const fakeWorker = {
      addEventListener: (type: string, handler: (event: { data: unknown }) => void) => {
        if (type === 'message') handlers.add(handler);
      },
      removeEventListener: (_type: string, handler: (event: { data: unknown }) => void) => {
        handlers.delete(handler);
      },
      postMessage: () => undefined,
      terminate: vi.fn(),
    } as unknown as Worker;
    vi.stubGlobal('Worker', function FakeWorker() {
      return fakeWorker;
    });

    const runner = createLayoutRunner(() => fakeWorker);
    const diff = proposeLayout(graphFromDoc(board(4)), { algorithm: 'tree' });
    const pending = runner.run(graphFromDoc(board(4)), { algorithm: 'tree' });
    for (const handler of [...handlers]) {
      handler({ data: { kind: 'progress', runId: 1, fraction: 0.5 } });
      handler({ data: { kind: 'done', runId: 1, diff } });
    }
    await expect(pending).resolves.toEqual(diff);
    runner.dispose();
    vi.unstubAllGlobals();
  });
});

describe('AutoArrangePanel', () => {
  const renderPanel = (doc: Y.Doc, selectedIds: readonly string[] = []) => {
    const history = { undo: vi.fn() };
    render(
      <AutoArrangePanel
        doc={doc}
        history={history}
        selectedIds={selectedIds}
        workerFactory={null}
      />,
    );
    return history;
  };

  it('renders nothing until it is opened', () => {
    renderPanel(board());
    expect(screen.queryByTestId('auto-arrange-panel')).toBeNull();
  });

  it('previews without touching the document, then applies in one step', async () => {
    const user = userEvent.setup();
    const doc = board(8);
    const history = renderPanel(doc);
    act(() => useAutoArrangeStore.getState().setOpen(true));

    const before = listNodes(doc).map((node) => ({ id: node.id, x: node.x, y: node.y }));
    await user.click(screen.getByTestId('auto-arrange-preview'));
    await waitFor(() => expect(useAutoArrangeStore.getState().diff).not.toBeNull());
    // A preview is a proposal: the board is untouched until Apply (N4).
    expect(listNodes(doc).map((node) => ({ id: node.id, x: node.x, y: node.y }))).toEqual(before);
    expect(screen.getByTestId('auto-arrange-status').textContent).toContain('nodes move');

    await user.click(screen.getByTestId('auto-arrange-apply'));
    expect(listNodes(doc).map((node) => ({ id: node.id, x: node.x, y: node.y }))).not.toEqual(
      before,
    );

    const toast = screen.getByTestId('layout-toast');
    expect(toast.textContent).toContain('One undo puts them back');
    await user.click(screen.getByTestId('layout-toast-undo'));
    expect(history.undo).toHaveBeenCalledTimes(1);
  });

  it('says so when there is nothing to arrange', async () => {
    const user = userEvent.setup();
    const doc = board(2);
    renderPanel(doc);
    act(() => useAutoArrangeStore.getState().setOpen(true));
    await user.click(screen.getByTestId('auto-arrange-preview'));
    await waitFor(() => expect(useAutoArrangeStore.getState().status).not.toBe('running'));
    // Running the same layout twice in a row proposes nothing the second time.
    await user.click(screen.getByTestId('auto-arrange-apply'));
    act(() => useAutoArrangeStore.getState().setOpen(true));
    await user.click(screen.getByTestId('auto-arrange-preview'));
    await waitFor(() => expect(useAutoArrangeStore.getState().status).toBe('empty'));
    expect(screen.getByTestId('auto-arrange-status').textContent).toContain('already arranged');
  });

  it('refuses a selection scope with fewer than two nodes and explains why', async () => {
    const user = userEvent.setup();
    renderPanel(board(6), ['n0']);
    act(() => useAutoArrangeStore.getState().setOpen(true));
    await user.click(screen.getByLabelText(/Selection/));
    expect(screen.getByTestId('auto-arrange-preview')).toBeDisabled();
    expect(screen.getByTestId('auto-arrange-status').textContent).toContain('at least two nodes');
  });

  it('shows the empty-board state', () => {
    const doc = createBoardDoc({ boardId: 'b2', title: 'Empty', now: NOW });
    renderPanel(doc);
    act(() => useAutoArrangeStore.getState().setOpen(true));
    expect(screen.getByTestId('auto-arrange-status').textContent).toContain('Nothing to lay out');
    expect(screen.getByTestId('auto-arrange-preview')).toBeDisabled();
  });

  it('offers per-algorithm options and invalidates the preview when they change', async () => {
    const user = userEvent.setup();
    renderPanel(board(6));
    act(() => useAutoArrangeStore.getState().setOpen(true));
    await user.click(screen.getByTestId('auto-arrange-preview'));
    await waitFor(() => expect(useAutoArrangeStore.getState().diff).not.toBeNull());

    await user.selectOptions(screen.getByLabelText('Layout'), 'force');
    expect(useAutoArrangeStore.getState().diff).toBeNull();
    // Force-directed exposes iterations and a variation seed; hierarchical exposes a direction.
    expect(screen.getByLabelText('Settling passes')).toBeTruthy();
    expect(screen.getByLabelText('Variation')).toBeTruthy();
    expect(screen.queryByLabelText('Direction')).toBeNull();
  });

  it('reports a failed run', async () => {
    const user = userEvent.setup();
    renderPanel(board(4));
    act(() => useAutoArrangeStore.getState().setOpen(true));
    act(() => useAutoArrangeStore.getState().failed('Layout worker died'));
    expect(screen.getByText('Layout worker died')).toBeTruthy();
    // Recoverable: changing anything clears the error and lets the analyst try again.
    await user.selectOptions(screen.getByLabelText('Layout'), 'radial');
    expect(useAutoArrangeStore.getState().error).toBeNull();
  });

  it('discards the preview on Escape', async () => {
    const user = userEvent.setup();
    renderPanel(board(6));
    act(() => useAutoArrangeStore.getState().setOpen(true));
    await user.click(screen.getByTestId('auto-arrange-preview'));
    await waitFor(() => expect(useAutoArrangeStore.getState().diff).not.toBeNull());
    await user.keyboard('{Escape}');
    expect(useAutoArrangeStore.getState().diff).toBeNull();
  });
});
