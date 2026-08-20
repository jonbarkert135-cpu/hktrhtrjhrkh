#!/usr/bin/env -S pnpm exec tsx
/**
 * `pnpm db:reproject --board <id> | --all` (08_DATA_MODEL.md §5.5, P8 §5.3/§11).
 *
 * Rebuilds a board's `nodes`/`edges` projection from scratch from its latest snapshot bytes,
 * bypassing the incremental diff path entirely. Uses the same `diffBoardDoc` ground truth
 * `packages/domain/test/projection.diff.test.ts` checks the incremental path against, from an
 * empty prior state — which is exactly a full projection. Safe to run any time: the projection is
 * derived data (00_MASTER.md §2.2 "the CRDT wins").
 */

import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { prisma } from '@nexus/db';
import { diffBoardDoc, emptyProjectionState } from '@nexus/domain';

import {
  createPrismaProjectionWriter,
  createPrismaSnapshotStore,
} from '../apps/sync/src/persistence.ts';

async function reprojectBoard(boardId: string): Promise<void> {
  const snapshotStore = createPrismaSnapshotStore(prisma, () => randomUUID());
  const writer = createPrismaProjectionWriter(prisma);

  const snap = await snapshotStore.latest(boardId);
  if (!snap) {
    process.stdout.write(`skip ${boardId}: no snapshot\n`);
    return;
  }

  const doc = new Y.Doc();
  Y.applyUpdateV2(doc, snap.binary);

  // Wipe and rebuild — the projection is disposable by construction (08 §5.6).
  await prisma.$transaction([
    prisma.boardProjectionNode.deleteMany({ where: { boardId } }),
    prisma.boardProjectionEdge.deleteMany({ where: { boardId } }),
  ]);

  const diff = diffBoardDoc(doc, emptyProjectionState());
  await writer.applyDiff(boardId, diff);
  await writer.markProjected(boardId, new Date());

  process.stdout.write(
    `reprojected ${boardId} (${String(diff.upsertNodes.length)} nodes, ${String(diff.upsertEdges.length)} edges)\n`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const boardFlag = args.indexOf('--board');
  const all = args.includes('--all');

  if (boardFlag !== -1) {
    const boardId = args[boardFlag + 1];
    if (!boardId) throw new Error('--board requires an id');
    await reprojectBoard(boardId);
  } else if (all) {
    const boards = await prisma.board.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    for (const board of boards) await reprojectBoard(board.id);
  } else {
    process.stderr.write('usage: reproject.ts --board <id> | --all\n');
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

void main();
