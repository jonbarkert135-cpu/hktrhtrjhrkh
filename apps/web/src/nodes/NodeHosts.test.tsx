/**
 * The engine ⇄ React bridge (P4 §7). The engine decides which nodes get a DOM host; React only
 * fills the slots it is given. The fake engine here is exactly the surface the bridge uses, which
 * is the point: if the bridge starts needing more of the engine, this test stops compiling.
 */

import { createBoardDoc, createNode, updateNode } from '@nexus/domain';
import type { Engine, EngineEvents } from '@nexus/canvas-engine';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NodeHosts } from './NodeHosts.tsx';
import { createNodeStore } from './nodeStore.ts';

const T0 = '2026-06-01T00:00:00.000Z';

function fakeEngine(): {
  engine: Engine;
  emitHosts: (ids: string[]) => void;
  emitZoom: (zoom: number) => void;
} {
  const hosts: Array<EngineEvents['hostsChanged']> = [];
  const cameras: Array<EngineEvents['cameraChanged']> = [];
  const engine = {
    camera: { state: { x: 0, y: 0, zoom: 1 } },
    on: (event: keyof EngineEvents, listener: unknown) => {
      if (event === 'hostsChanged') hosts.push(listener as EngineEvents['hostsChanged']);
      if (event === 'cameraChanged') cameras.push(listener as EngineEvents['cameraChanged']);
      return () => undefined;
    },
  } as unknown as Engine;
  return {
    engine,
    emitHosts: (ids) => {
      for (const listener of hosts) listener(ids);
    },
    emitZoom: (zoom) => {
      for (const listener of cameras) listener({ x: 0, y: 0, zoom }, 'user');
    },
  };
}

function setup() {
  const doc = createBoardDoc({ boardId: 'b_hosts', now: T0 });
  const ids: string[] = [];
  let counter = 0;
  for (const title of ['First', 'Second']) {
    const { node } = createNode(
      doc,
      {
        type: 'website',
        x: 0,
        y: 0,
        title,
        data: { url: 'https://example.com', description: 'Detail text' },
      },
      { now: T0, makeId: () => `n_${String(++counter)}` },
    );
    ids.push(node.id);
  }
  const slots = new Map<string, HTMLElement>();
  for (const id of ids) {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    slots.set(id, slot);
  }
  return { doc, ids, slots, store: createNodeStore(doc) };
}

describe('NodeHosts', () => {
  it('renders a card into each promoted slot and drops it when the engine unmounts it', () => {
    const { ids, slots, store } = setup();
    const { engine, emitHosts } = fakeEngine();
    render(<NodeHosts engine={engine} store={store} slotOf={(id) => slots.get(id)} />);

    expect(screen.queryByText('First')).not.toBeInTheDocument();

    act(() => emitHosts(ids));
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();

    act(() => emitHosts([ids[0] ?? '']));
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
  });

  it('skips ids the overlay has no slot for', () => {
    const { ids, slots, store } = setup();
    const { engine, emitHosts } = fakeEngine();
    render(<NodeHosts engine={engine} store={store} slotOf={(id) => slots.get(id)} />);
    act(() => emitHosts([...ids, 'n_missing']));
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('switches to detailed cards above the L3 zoom threshold', () => {
    const { ids, slots, store } = setup();
    const { engine, emitHosts, emitZoom } = fakeEngine();
    render(<NodeHosts engine={engine} store={store} slotOf={(id) => slots.get(id)} />);
    act(() => emitHosts([ids[0] ?? '']));
    expect(screen.queryByText('Detail text')).not.toBeInTheDocument();

    act(() => emitZoom(2));
    expect(screen.getByText('Detail text')).toBeInTheDocument();
  });

  it('marks the selected card, and multi-selection when several are selected', () => {
    const { ids, slots, store } = setup();
    const { engine, emitHosts } = fakeEngine();
    const { rerender } = render(
      <NodeHosts
        engine={engine}
        store={store}
        slotOf={(id) => slots.get(id)}
        selectedIds={[ids[0] ?? '']}
      />,
    );
    act(() => emitHosts(ids));
    expect(screen.getByTestId(`node-card-${ids[0] ?? ''}`)).toHaveAttribute(
      'data-state',
      'selected',
    );

    rerender(
      <NodeHosts engine={engine} store={store} slotOf={(id) => slots.get(id)} selectedIds={ids} />,
    );
    expect(screen.getByTestId(`node-card-${ids[0] ?? ''}`)).toHaveAttribute(
      'data-state',
      'multi-selected',
    );
  });

  it('re-renders a card when its own node changes', () => {
    const { doc, ids, slots, store } = setup();
    const { engine, emitHosts } = fakeEngine();
    render(<NodeHosts engine={engine} store={store} slotOf={(id) => slots.get(id)} />);
    act(() => emitHosts(ids));

    act(() => {
      updateNode(doc, ids[0] ?? '', { title: 'Renamed' }, { origin: 'local:edit', now: T0 });
    });
    expect(screen.getByText('Renamed')).toBeInTheDocument();
  });

  it('renders nothing without an engine', () => {
    const { slots, store } = setup();
    render(<NodeHosts engine={null} store={store} slotOf={(id) => slots.get(id)} />);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });
});
