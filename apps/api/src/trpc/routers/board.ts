import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@nexus/db';
import { newId } from '@nexus/domain';
import { orgProcedure, router } from '../trpc.js';
import { audit } from '../../audit.js';
import { Id } from './project.js';

interface BoardRow {
  id: string;
  projectId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

const toDto = (b: BoardRow) => ({
  id: b.id,
  projectId: b.projectId,
  title: b.title,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

/** A board is only reachable through a live project of the caller's org. */
async function assertProjectInOrg(projectId: string, orgId: string): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!project) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That project no longer exists.' });
  }
}

export const boardRouter = router({
  list: orgProcedure('viewer')
    .input(z.object({ projectId: Id, limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      await assertProjectInOrg(input.projectId, ctx.org.id);
      const boards = await prisma.board.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: input.limit,
      });
      return boards.map(toDto);
    }),

  create: orgProcedure('editor')
    .input(z.object({ projectId: Id, title: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectInOrg(input.projectId, ctx.org.id);
      const board = await prisma.board.create({
        data: {
          id: newId.board(),
          orgId: ctx.org.id,
          projectId: input.projectId,
          title: input.title,
          createdBy: ctx.user.id,
        },
      });
      await audit(
        {
          action: 'board.created',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'board',
          targetId: board.id,
          ip: ctx.ip,
        },
        ctx.logger,
      );
      return toDto(board);
    }),
});
