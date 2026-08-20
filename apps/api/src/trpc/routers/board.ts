import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@nexus/db';
import { newId, systemClock } from '@nexus/domain';
import { orgProcedure, router } from '../trpc.ts';
import { audit } from '../../audit.ts';
import { Id } from './project.ts';

interface BoardRow {
  id: string;
  projectId: string;
  title: string;
  icon: string | null;
  templateOf: string | null;
  isTemplate: boolean;
  archivedAt: Date | null;
  lastOpenedAt: Date | null;
  nodeCount: number;
  edgeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const toDto = (b: BoardRow) => ({
  id: b.id,
  projectId: b.projectId,
  title: b.title,
  icon: b.icon,
  templateOf: b.templateOf,
  isTemplate: b.isTemplate,
  archivedAt: b.archivedAt,
  lastOpenedAt: b.lastOpenedAt,
  nodeCount: b.nodeCount,
  edgeCount: b.edgeCount,
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

/** A live (not soft-deleted) board of the caller's org, or a user-facing not-found error. */
async function requireBoard(boardId: string, orgId: string): Promise<BoardRow> {
  const board = await prisma.board.findFirst({ where: { id: boardId, orgId, deletedAt: null } });
  if (!board) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That board no longer exists.' });
  }
  return board;
}

/** Non-negative, finite — a save can only ever report a count that makes sense (P7 §5.1). */
const clampCount = (n: number): number => (Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);

export const boardRouter = router({
  list: orgProcedure('viewer')
    .input(
      z.object({
        projectId: Id,
        limit: z.number().int().min(1).max(200).default(50),
        includeArchived: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectInOrg(input.projectId, ctx.org.id);
      const boards = await prisma.board.findMany({
        where: {
          projectId: input.projectId,
          deletedAt: null,
          ...(input.includeArchived ? {} : { archivedAt: null }),
        },
        orderBy: { updatedAt: 'desc' },
        take: input.limit,
      });
      return boards.map(toDto);
    }),

  create: orgProcedure('editor')
    .input(
      z.object({
        projectId: Id,
        title: z.string().trim().min(1).max(120),
        // The id of a built-in template or another board — see the comment on `board.duplicate`
        // for why this only records provenance server-side rather than seeding real content.
        templateId: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectInOrg(input.projectId, ctx.org.id);
      const board = await prisma.board.create({
        data: {
          id: newId.board(),
          orgId: ctx.org.id,
          projectId: input.projectId,
          title: input.title,
          templateOf: input.templateId ?? null,
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

  rename: orgProcedure('editor')
    .input(z.object({ boardId: Id, title: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      await requireBoard(input.boardId, ctx.org.id);
      const board = await prisma.board.update({
        where: { id: input.boardId },
        data: { title: input.title },
      });
      await audit(
        {
          action: 'board.renamed',
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

  move: orgProcedure('editor')
    .input(z.object({ boardId: Id, projectId: Id }))
    .mutation(async ({ ctx, input }) => {
      await requireBoard(input.boardId, ctx.org.id);
      await assertProjectInOrg(input.projectId, ctx.org.id);
      const board = await prisma.board.update({
        where: { id: input.boardId },
        data: { projectId: input.projectId },
      });
      await audit(
        {
          action: 'board.moved',
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

  archive: orgProcedure('editor')
    .input(z.object({ boardId: Id }))
    .mutation(async ({ ctx, input }) => {
      await requireBoard(input.boardId, ctx.org.id);
      const board = await prisma.board.update({
        where: { id: input.boardId },
        data: { archivedAt: systemClock.now() },
      });
      await audit(
        {
          action: 'board.archived',
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

  restore: orgProcedure('editor')
    .input(z.object({ boardId: Id }))
    .mutation(async ({ ctx, input }) => {
      await requireBoard(input.boardId, ctx.org.id);
      const board = await prisma.board.update({
        where: { id: input.boardId },
        data: { archivedAt: null },
      });
      await audit(
        {
          action: 'board.restored',
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

  delete: orgProcedure('editor')
    .input(z.object({ boardId: Id }))
    .mutation(async ({ ctx, input }) => {
      const board = await requireBoard(input.boardId, ctx.org.id);
      // Soft delete: the row is purged by the maintenance job after the undo window.
      await prisma.board.update({ where: { id: board.id }, data: { deletedAt: systemClock.now() } });
      await audit(
        {
          action: 'board.deleted',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'board',
          targetId: board.id,
          ip: ctx.ip,
        },
        ctx.logger,
      );
      return { ok: true as const };
    }),

  /**
   * Duplicates the board *row* only: title, project and template flags. The board's actual
   * content (nodes, edges, files) lives in the Y.Doc, which `apps/api` does not store anywhere yet
   * — that is the sync projection P8 introduces. Local mode's `duplicateBoard` in
   * `apps/web/src/data/workspace/local.ts` does the full deep copy today; server mode gets it once
   * P8 gives this router something to copy from.
   */
  duplicate: orgProcedure('editor')
    .input(z.object({ boardId: Id, title: z.string().trim().min(1).max(120).optional() }))
    .mutation(async ({ ctx, input }) => {
      const source = await requireBoard(input.boardId, ctx.org.id);
      const board = await prisma.board.create({
        data: {
          id: newId.board(),
          orgId: ctx.org.id,
          projectId: source.projectId,
          title: input.title ?? `${source.title} copy`,
          icon: source.icon,
          templateOf: source.id,
          createdBy: ctx.user.id,
        },
      });
      await audit(
        {
          action: 'board.duplicated',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'board',
          targetId: board.id,
          metadata: { sourceBoardId: source.id, contentCopied: false },
          ip: ctx.ip,
        },
        ctx.logger,
      );
      return toDto(board);
    }),

  saveAsTemplate: orgProcedure('editor')
    .input(z.object({ boardId: Id }))
    .mutation(async ({ ctx, input }) => {
      await requireBoard(input.boardId, ctx.org.id);
      const board = await prisma.board.update({
        where: { id: input.boardId },
        data: { isTemplate: true },
      });
      await audit(
        {
          action: 'board.saved_as_template',
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

  /** Fire-and-forget from the UI on open; not audited (too frequent to be a security signal). */
  touchOpened: orgProcedure('viewer')
    .input(z.object({ boardId: Id }))
    .mutation(async ({ ctx, input }) => {
      await requireBoard(input.boardId, ctx.org.id);
      await prisma.board.update({
        where: { id: input.boardId },
        data: { lastOpenedAt: systemClock.now() },
      });
      return { ok: true as const };
    }),

  /** Fire-and-forget from the UI after a save; not audited, same reason as `touchOpened`. */
  reportCounts: orgProcedure('editor')
    .input(z.object({ boardId: Id, nodeCount: z.number(), edgeCount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireBoard(input.boardId, ctx.org.id);
      await prisma.board.update({
        where: { id: input.boardId },
        data: {
          nodeCount: clampCount(input.nodeCount),
          edgeCount: clampCount(input.edgeCount),
        },
      });
      return { ok: true as const };
    }),
});
