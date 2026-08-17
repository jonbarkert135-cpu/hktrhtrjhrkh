import {
  addNode,
  createBoardDoc,
  listNodes,
  makeNode,
  removeNodes,
  updateNode,
} from '@nexus/domain';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SNAPSHOT_RETENTION,
  createSnapshotScheduler,
  createSnapshotStore,
  restoreSnapshot,
  snapshotOf,
  type SnapshotRecord,
} from './snapshots';

const NOW = '2026-08-17T12:00:00.000Z';
const local = { origin: 'local:create', now: NOW } as const;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
});

function board(id = 'b_snap') {
  const doc = createBoardDoc({ boardId: id, now: NOW });
  addNode(doc, makeNode({ id: 'n1', x: 0, y: 0, title: 'first' }, NOW), local);
  return doc;
}

describe('snapshot store', () => {
  it('saves, lists and loads snapshots newest first', async () => {
    const store = createSnapshotStore();
    const doc = board();
    await store.save(snapshotOf(doc, 'b_snap', 's1', 1_000, 'auto'));
    await store.save(snapshotOf(doc, 'b_snap', 's2', 2_000, 'checkpoint'));
    await store.save(snapshotOf(doc, 'other', 's3', 3_000, 'auto'));

    const list = await store.list('b_snap');
    expect(list.map((record) => record.id)).toEqual(['s2', 's1']);
    expect(list[0]).not.toHaveProperty('update');
    expect(list[0]?.nodeCount).toBe(1);
    expect((await store.load('s1'))?.reason).toBe('auto');
    expect(await store.load('missing')).toBeNull();
  });

  it('keeps only the newest N snapshots', async () => {
    const store = createSnapshotStore();
    const doc = board();
    for (let i = 0; i < SNAPSHOT_RETENTION + 3; i += 1) {
      await store.save(snapshotOf(doc, 'b_snap', `s${String(i)}`, 1_000 + i, 'auto'));
    }
    expect(await store.list('b_snap')).toHaveLength(SNAPSHOT_RETENTION);
    expect(await store.prune('b_snap', 5)).toBe(SNAPSHOT_RETENTION - 5);
  });
});

describe('snapshot scheduler', () => {
  it('captures after the configured number of operations', async () => {
    const doc = board();
    const store = createSnapshotStore();
    const scheduler = createSnapshotScheduler({
      boardId: 'b_snap',
      doc,
      store,
      operationInterval: 3,
      now: () => 5_000,
    });

    for (let i = 0; i < 3; i += 1) {
      updateNode(doc, 'n1', { title: `t${String(i)}` }, { origin: 'local:edit', now: NOW });
    }
    await vi.waitFor(async () => {
      expect(await store.list('b_snap')).toHaveLength(1);
    });
    expect(scheduler.pending).toBe(0);
    scheduler.destroy();
  });

  it('captures after the time interval and ignores remote updates', async () => {
    const doc = board();
    const store = createSnapshotStore();
    let clock = 0;
    const scheduler = createSnapshotScheduler({
      boardId: 'b_snap',
      doc,
      store,
      operationInterval: 1_000,
      timeIntervalMs: 100,
      now: () => clock,
    });

    doc.transact(() => undefined, 'remote:sync');
    expect(scheduler.pending).toBe(0);

    clock = 500;
    updateNode(doc, 'n1', { title: 'later' }, { origin: 'local:edit', now: NOW });
    await vi.waitFor(async () => {
      expect(await store.list('b_snap')).toHaveLength(1);
    });
    scheduler.destroy();
  });

  it('reports a failing store instead of throwing into the app', async () => {
    const onError = vi.fn();
    const failing = {
      save: () => Promise.reject(new Error('quota')),
      list: () => Promise.resolve([]),
      load: () => Promise.resolve(null),
      prune: () => Promise.resolve(0),
    };
    const scheduler = createSnapshotScheduler({
      boardId: 'b_snap',
      doc: board(),
      store: failing,
      onError,
    });
    expect(await scheduler.capture('checkpoint')).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
    scheduler.destroy();
  });

  it('mints unique ids by default', async () => {
    const store = createSnapshotStore();
    const scheduler = createSnapshotScheduler({ boardId: 'b_snap', doc: board(), store });
    const first = await scheduler.capture('checkpoint');
    const second = await scheduler.capture('checkpoint');
    expect(first?.id).not.toBe(second?.id);
    scheduler.destroy();
  });
});

describe('restore', () => {
  it('restores a past version as a new, undoable operation', () => {
    const doc = board();
    const record: SnapshotRecord = snapshotOf(doc, 'b_snap', 's1', 1_000, 'auto');

    addNode(doc, makeNode({ id: 'n2', x: 10, y: 10, title: 'after' }, NOW), local);
    removeNodes(doc, ['n1'], { origin: 'local:delete', now: NOW });
    expect(listNodes(doc).map((node) => node.id)).toEqual(['n2']);

    const report = restoreSnapshot(doc, record);
    expect(report.removed).toBe(1);
    expect(listNodes(doc).map((node) => node.title)).toEqual(['first']);
  });
});
