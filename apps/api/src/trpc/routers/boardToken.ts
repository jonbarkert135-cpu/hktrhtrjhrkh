/**
 * Issues short-lived board tokens for the sync service (P8 §5.1/§5.2). The API is the single
 * source of authorization truth — the sync service never queries permissions itself (P8 §9); it
 * only verifies the signature and scope of what this router hands out.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '@nexus/db';
import type { BoardRole } from '@nexus/domain';

import { issueBoardToken } from '../../boardToken.ts';
import { orgProcedure, router } from '../trpc.ts';
import { Id } from './project.ts';

/** A stable, non-PII color per user for cursors/avatars (P8 §9: no email is ever exposed). */
function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${String(hue)}, 70%, 55%)`;
}

async function assertBoardInOrg(boardId: string, orgId: string): Promise<void> {
  const board = await prisma.board.findFirst({
    where: { id: boardId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!board) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That board no longer exists.' });
  }
}

export const boardTokenRouter = router({
  issue: orgProcedure('viewer')
    .input(z.object({ boardId: Id }))
    .mutation(async ({ ctx, input }) => {
      await assertBoardInOrg(input.boardId, ctx.org.id);
      // The caller's org role *is* their board role — P8 ships with org-level roles; a
      // per-board membership model is a later phase's addition (20_ROADMAP.md P8 deviation note).
      const role = ctx.role as BoardRole;
      const token = issueBoardToken({
        userId: ctx.user.id,
        boardId: input.boardId,
        role,
        name: ctx.user.name,
        color: colorForUser(ctx.user.id),
      });
      return { token, expiresInMs: 5 * 60 * 1000 };
    }),
});
