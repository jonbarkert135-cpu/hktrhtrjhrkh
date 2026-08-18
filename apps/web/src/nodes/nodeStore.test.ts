/**
 * Re-render isolation (P4 §7, §10, acceptance criterion 6). The assertion that matters: editing one
 * node on a 200-node board notifies exactly one subscriber.
 */

import { createBoardDoc, createNode, deleteNode, updateNodeData } from '@nexus/domain';
import { describe, expect, it, vi } from 'vitest';

import { createNodeStore } from './nodeStore.ts';

const T0 = '2026-06-01T00:00:00.000Z';

function boardWith(count: number) {
  const doc = createBoardDoc({ boardId: 'b_store', now: T0 });
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const { node } = createNode(
      doc,
      { type: 'note', x: i, y: 0, title: `n${String(i)}` },
      { now: T0, makeId: () => `n_${String(i)}` },
    );
    ids.push(node.id);
  }
  return { doc, ids };
}

describe('createNodeStore', () => {
  it('notifies only the edited node on a 200-node board', () => {
    const { doc, ids } = boardWith(200);
    const store = createNodeStore(doc);
    const listeners = ids.map((id) => {
      const spy = vi.fn();
      store.subscribe(id, spy);
      return spy;
    });

    updateNodeData(doc, ids[7] ?? '', { severity: 'critical' }, { now: T0 });

    expect(listeners[7]).toHaveBeenCalledTimes(1);
    expect(listeners.filter((spy) => spy.mock.calls.length > 0)).toHaveLength(1);
    store.destroy();
  });

  it('hands out a new snapshot only for the node that changed', () => {
    const { doc, ids } = boardWith(3);
    const store = createNodeStore(doc);
    const before = ids.map((id) => store.getSnapshot(id));

    updateNodeData(doc, ids[1] ?? '', { severity: 'finding' }, { now: T0 });

    expect(store.getSnapshot(ids[0] ?? '')).toBe(before[0]);
    expect(store.getSnapshot(ids[1] ?? '')).not.toBe(before[1]);
    expect(store.getSnapshot(ids[1] ?? '')?.data['severity']).toBe('finding');
    store.destroy();
  });

  it('tracks the id list separately from node content', () => {
    const { doc, ids } = boardWith(1);
    const store = createNodeStore(doc);
    const onIds = vi.fn();
    const onNode = vi.fn();
    store.subscribeIds(onIds);
    store.subscribe(ids[0] ?? '', onNode);

    updateNodeData(doc, ids[0] ?? '', { severity: 'finding' }, { now: T0 });
    expect(onIds).not.toHaveBeenCalled();
    expect(onNode).toHaveBeenCalledTimes(1);

    createNode(doc, { type: 'link', x: 0, y: 0 }, { now: T0, makeId: () => 'n_new' });
    expect(onIds).toHaveBeenCalledTimes(1);
    expect(store.getIds()).toHaveLength(2);
    store.destroy();
  });

  it('stops notifying after unsubscribe and after destroy', () => {
    const { doc, ids } = boardWith(2);
    const store = createNodeStore(doc);
    const spy = vi.fn();
    const unsubscribe = store.subscribe(ids[0] ?? '', spy);

    unsubscribe();
    updateNodeData(doc, ids[0] ?? '', { severity: 'finding' }, { now: T0 });
    expect(spy).not.toHaveBeenCalled();

    const second = vi.fn();
    store.subscribe(ids[1] ?? '', second);
    store.destroy();
    updateNodeData(doc, ids[1] ?? '', { severity: 'finding' }, { now: T0 });
    expect(second).not.toHaveBeenCalled();
  });

  it('reports a deleted node as undefined', () => {
    const { doc, ids } = boardWith(1);
    const store = createNodeStore(doc);
    const id = ids[0] ?? '';
    expect(store.getSnapshot(id)).toBeDefined();

    deleteNode(doc, id, { now: T0 });
    expect(store.getSnapshot(id)).toBeUndefined();
    expect(store.getIds()).toEqual([]);
    store.destroy();
  });
});
