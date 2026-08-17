/**
 * N2: a mutation must be durable within 100 ms, and a previously visited board must open with zero
 * network. Both are asserted against a real (in-memory) IndexedDB through `fake-indexeddb`.
 */

import { createBoardDoc, emptyBoardDoc, addNode, listNodes, makeNode } from '@nexus/domain';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexeddbPersistence } from 'y-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DURABILITY_BUDGET_MS, boardStoreName, createPersistence } from './persistence';

const NOW = '2026-08-17T12:00:00.000Z';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  // y-indexeddb uses key ranges, so both globals have to come from the fake implementation.
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('local persistence', () => {
  it('names one IndexedDB store per board', () => {
    expect(boardStoreName('b_1')).toBe('nexus-board-b_1');
  });

  it('writes a mutation to IndexedDB inside the durability budget and reloads it', async () => {
    const doc = createBoardDoc({ boardId: 'b_dur', now: NOW });
    const handle = createPersistence({ boardId: 'b_dur', doc });
    await handle.whenLoaded;

    addNode(doc, makeNode({ id: 'n1', x: 1, y: 2, title: 'Durable' }, NOW), {
      origin: 'local:create',
      now: NOW,
    });
    await sleep(DURABILITY_BUDGET_MS);
    await handle.destroy();

    // A fresh tab: nothing but IndexedDB, no network at all.
    const reopened = emptyBoardDoc('b_dur');
    const second = createPersistence({ boardId: 'b_dur', doc: reopened });
    await second.whenLoaded;
    expect(listNodes(reopened).map((node) => node.title)).toEqual(['Durable']);
    await second.destroy();
  });

  it('reports Saved only once the write is flushed', async () => {
    const doc = createBoardDoc({ boardId: 'b_status', now: NOW });
    const handle = createPersistence({ boardId: 'b_status', doc, now: () => 1_000 });
    await handle.whenLoaded;
    const states: string[] = [];
    const off = handle.subscribe((status) => states.push(status.state));

    addNode(doc, makeNode({ id: 'n1', x: 0, y: 0 }, NOW), { origin: 'local:create', now: NOW });
    expect(handle.status().state).toBe('saving');
    await sleep(DURABILITY_BUDGET_MS);
    expect(handle.status().state).toBe('saved');
    expect(handle.status().lastSavedAt).toBe(1_000);
    expect(states).toContain('saving');

    off();
    await handle.destroy();
  });

  it('follows the browser connectivity signal', async () => {
    const doc = createBoardDoc({ boardId: 'b_net', now: NOW });
    const listeners: Array<(online: boolean) => void> = [];
    const notify = (online: boolean): void => listeners.forEach((fn) => fn(online));
    const handle = createPersistence({
      boardId: 'b_net',
      doc,
      connectivity: {
        isOnline: () => true,
        subscribe: (fn) => {
          listeners.push(fn);
          return () => listeners.splice(listeners.indexOf(fn), 1);
        },
      },
    });
    await handle.whenLoaded;
    notify(false);
    expect(handle.status().state).toBe('offline');
    notify(true);
    expect(handle.status().online).toBe(true);
    await handle.destroy();
  });

  it('surfaces a storage failure as an actionable error and can retry', async () => {
    const doc = createBoardDoc({ boardId: 'b_fail', now: NOW });
    let attempts = 0;
    const handle = createPersistence({
      boardId: 'b_fail',
      doc,
      createProvider: (name, target) => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('disk full');
          error.name = 'QuotaExceededError';
          throw error;
        }
        return new IndexeddbPersistence(name, target);
      },
    });
    await handle.whenLoaded;

    expect(handle.status().state).toBe('error');
    expect(handle.status().error?.kind).toBe('quota');
    expect(handle.status().error?.message).toMatch(/export the board/i);

    handle.retry();
    expect(attempts).toBe(2);
    expect(handle.status().error).toBeNull();
    await handle.destroy();
  });

  it('reports a rejected provider load as an error instead of hanging', async () => {
    const doc = createBoardDoc({ boardId: 'b_reject', now: NOW });
    const handle = createPersistence({
      boardId: 'b_reject',
      doc,
      createProvider: () =>
        ({
          on: () => undefined,
          whenSynced: Promise.reject(new Error('IndexedDB is not supported in private mode')),
          destroy: () => Promise.resolve(),
        }) as unknown as IndexeddbPersistence,
    });
    await handle.whenLoaded;
    expect(handle.status().state).toBe('error');
    expect(handle.status().error?.kind).toBe('unavailable');
    await handle.destroy();
  });
});
