/**
 * BoardWorkspace's engine-dependent wiring: node duplicate/delete through the card rail (P7 §5/§7).
 * `CanvasHost` needs a real 2D context (`CanvasHost.test.tsx` covers it on its own), so this file
 * stands in a fake `Engine` — exactly the surface `NodeHosts.test.tsx` uses for the same reason —
 * to exercise BoardWorkspace's own engine-dependent branches: the scene-patch effect, the node
 * rail actions and the doc-driven counters that follow them.
 */

import { listNodes } from '@nexus/domain';
import type { Engine, EngineEvents } from '@nexus/canvas-engine';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import type * as Y from 'yjs';

import { BoardDocProvider, useBoardDoc } from '../../data/docProvider';
import { WorkspaceProvider } from '../../data/workspace/context';
import { fakeWorkspaceRepository } from '../../data/workspace/testFakes';

const state = vi.hoisted(() => ({
  slots: new Map<string, HTMLElement>(),
  hosts: [] as Array<EngineEvents['hostsChanged']>,
}));

vi.mock('../canvas/CanvasHost', () => {
  return {
    CanvasHost: (props: {
      onEngine?: (engine: Engine | null) => void;
      children?: (api: {
        slotOf: (id: string) => HTMLElement | undefined;
        screenOf: (world: { x: number; y: number }) => { x: number; y: number };
      }) => ReactNode;
    }) => {
      const engine = {
        camera: {
          screenToWorld: (p: { x: number; y: number }) => p,
          viewportWorld: { x: 0, y: 0, w: 800, h: 600 },
          focus: vi.fn(),
          fit: vi.fn(),
          fitAll: vi.fn(),
          reset: vi.fn(),
          state: { x: 0, y: 0, zoom: 1 },
        },
        query: { sceneBounds: { x: 0, y: 0, w: 0, h: 0 }, nodeCount: 0 },
        selection: { set: vi.fn() },
        state: { interaction: 'idle' },
        applyScenePatch: vi.fn(),
        on: (event: keyof EngineEvents, listener: unknown) => {
          if (event === 'hostsChanged') state.hosts.push(listener as EngineEvents['hostsChanged']);
          return () => undefined;
        },
      } as unknown as Engine;

      useEffect(() => {
        props.onEngine?.(engine);
        return () => props.onEngine?.(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      if (!props.children) return null;
      return props.children({
        slotOf: (id: string) => state.slots.get(id),
        screenOf: (world) => world,
      });
    },
  };
});

// Imported after the mock so BoardWorkspace picks up the mocked CanvasHost.
const { BoardWorkspace } = await import('./BoardWorkspace');

let capturedDoc: Y.Doc | null = null;

/** Sits beside `BoardWorkspace` purely to hand the test the same doc instance it renders from. */
function DocSpy() {
  const { doc } = useBoardDoc();
  capturedDoc = doc;
  return null;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  state.slots.clear();
  state.hosts.length = 0;
  capturedDoc = null;
});

function view() {
  return render(
    <MemoryRouter>
      <WorkspaceProvider repository={fakeWorkspaceRepository()}>
        <BoardDocProvider boardId="b_engine">
          <DocSpy />
          <BoardWorkspace />
        </BoardDocProvider>
      </WorkspaceProvider>
    </MemoryRouter>,
  );
}

function emitHosts(ids: string[]): void {
  for (const listener of state.hosts) listener(ids);
}

describe('<BoardWorkspace> with a real engine', () => {
  it('duplicates and deletes a node through the card rail', async () => {
    view();
    await waitFor(() => expect(screen.getByTestId('sync-status')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('add-note'));
    await waitFor(() =>
      expect(screen.getByTestId('node-count')).toHaveAttribute('data-nodes', '1'),
    );

    const doc = capturedDoc;
    if (doc === null) throw new Error('doc not captured');
    const [node] = listNodes(doc);
    if (node === undefined) throw new Error('no node created');

    // The engine promotes a host once it exists; give it a slot and announce the id.
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    state.slots.set(node.id, slot);
    emitHosts([node.id]);

    await waitFor(() => expect(screen.getByLabelText('Duplicate node')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Duplicate node'));
    await waitFor(() =>
      expect(screen.getByTestId('node-count')).toHaveAttribute('data-nodes', '2'),
    );

    fireEvent.click(screen.getByLabelText('Delete node'));
    await waitFor(() =>
      expect(screen.getByTestId('node-count')).toHaveAttribute('data-nodes', '1'),
    );
  });
});
