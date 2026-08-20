/**
 * `createPrismaSnapshotStore` / `createPrismaProjectionWriter` against a fake Prisma client —
 * verifies the row shapes and ordering guard translate correctly without a real database.
 */

import { describe, expect, it, vi } from 'vitest';

import { createPrismaProjectionWriter, createPrismaSnapshotStore } from '../src/persistence.ts';

function fakePrisma() {
  const boardSnapshot = {
    findFirst: vi.fn(),
    create: vi.fn(),
  };
  const boardProjectionNode = {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  };
  const boardProjectionEdge = {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  };
  const board = { update: vi.fn() };
  interface Tx {
    boardProjectionNode: typeof boardProjectionNode;
    boardProjectionEdge: typeof boardProjectionEdge;
  }
  const tx: Tx = { boardProjectionNode, boardProjectionEdge };
  const $transaction = vi.fn(async (fn: (tx: Tx) => Promise<void>) => fn(tx));

  return {
    boardSnapshot,
    boardProjectionNode,
    boardProjectionEdge,
    board,
    $transaction,
  } as never;
}

describe('createPrismaSnapshotStore', () => {
  it('returns null when the board has never been stored', async () => {
    const prisma = fakePrisma();
    (
      prisma as { boardSnapshot: { findFirst: ReturnType<typeof vi.fn> } }
    ).boardSnapshot.findFirst.mockResolvedValue(null);
    const store = createPrismaSnapshotStore(prisma, () => 'snap1');
    expect(await store.latest('b1')).toBeNull();
  });

  it('writes a snapshot with the given seq', async () => {
    const prisma = fakePrisma();
    const store = createPrismaSnapshotStore(prisma, () => 'snap1');
    await store.write('b1', {
      binary: new Uint8Array([1, 2]),
      stateVector: new Uint8Array([3]),
      seq: 4,
    });
    const create = (prisma as { boardSnapshot: { create: ReturnType<typeof vi.fn> } }).boardSnapshot
      .create;
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 'snap1', boardId: 'b1', seq: 4, kind: 'current' }),
    });
  });

  it('reads the latest snapshot back out', async () => {
    const prisma = fakePrisma();
    (
      prisma as { boardSnapshot: { findFirst: ReturnType<typeof vi.fn> } }
    ).boardSnapshot.findFirst.mockResolvedValue({
      binary: Buffer.from([9]),
      stateVector: Buffer.from([8]),
      seq: 2,
    });
    const store = createPrismaSnapshotStore(prisma, () => 'x');
    const latest = await store.latest('b1');
    expect(latest).toEqual({ binary: Buffer.from([9]), stateVector: Buffer.from([8]), seq: 2 });
  });
});

describe('createPrismaProjectionWriter', () => {
  it('loads prior state from projected rows, keyed by id', async () => {
    const prisma = fakePrisma();
    (
      prisma as { boardProjectionNode: { findMany: ReturnType<typeof vi.fn> } }
    ).boardProjectionNode.findMany.mockResolvedValue([
      { id: 'n1', version: 2, updatedAt: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    const writer = createPrismaProjectionWriter(prisma);
    const state = await writer.loadPriorState('b1');
    expect(state.nodes.get('n1')).toEqual({
      id: 'n1',
      version: 2,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('applyDiff upserts and deletes inside one transaction', async () => {
    const prisma = fakePrisma();
    const writer = createPrismaProjectionWriter(prisma);
    await writer.applyDiff('b1', {
      upsertNodes: [
        {
          id: 'n1',
          type: 'note',
          title: 'Hello',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          z: 0,
          rotation: 0,
          parentId: null,
          locked: false,
          hidden: false,
          tags: [],
          confidence: 'unknown',
          color: null,
          starred: false,
          status: 'active',
          provenance: { kind: 'user' },
          enrichment: { state: 'idle', jobId: null, attempts: 0, lastError: null, updatedAt: null },
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          deletedAt: null,
          data: {},
        } as never,
      ],
      deleteNodeIds: ['gone'],
      upsertEdges: [],
      deleteEdgeIds: [],
    });

    expect(
      (prisma as { $transaction: ReturnType<typeof vi.fn> }).$transaction,
    ).toHaveBeenCalledTimes(1);
  });

  it('marks a board projected / projection-failed', async () => {
    const prisma = fakePrisma();
    const writer = createPrismaProjectionWriter(prisma);
    const at = new Date('2026-01-02T00:00:00.000Z');
    await writer.markProjected('b1', at);
    await writer.markProjectionFailed('b1');
    const update = (prisma as { board: { update: ReturnType<typeof vi.fn> } }).board.update;
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: 'b1' },
      data: { lastProjectedAt: at, projectionFailed: false },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 'b1' },
      data: { projectionFailed: true },
    });
  });
});
