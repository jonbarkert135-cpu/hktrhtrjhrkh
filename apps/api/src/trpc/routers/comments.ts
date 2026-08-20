/**
 * Comment threads (P8 §5.10/§5.11/§9). Bodies are plain text, length-capped, sanitized on render
 * by the client; mentions resolve only against real project members — never an arbitrary email.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@nexus/db';
import { COMMENT_BODY_MAX_LENGTH, extractMentionHandles, newId } from '@nexus/domain';

import { MentionNotifier, type EmailSink, type InboxSink } from '../../mentions.ts';
import { orgProcedure, router } from '../trpc.ts';
import { Id } from './project.ts';

const AnchorInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), nodeId: z.string().min(1) }),
  z.object({ kind: z.literal('point'), x: z.number().finite(), y: z.number().finite() }),
]);

interface CommentRow {
  id: string;
  boardId: string;
  parentId: string | null;
  anchor: unknown;
  body: string;
  authorId: string;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const toDto = (c: CommentRow) => ({
  id: c.id,
  boardId: c.boardId,
  parentId: c.parentId,
  anchor: c.anchor,
  body: c.body,
  authorId: c.authorId,
  resolvedAt: c.resolvedAt,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

async function assertBoardInOrg(boardId: string, orgId: string): Promise<void> {
  const board = await prisma.board.findFirst({
    where: { id: boardId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!board) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That board no longer exists.' });
  }
}

/** No mailer ships yet (P1 deviation, restated in P8 §15) — logs instead of sending. */
const logOnlyEmailSink: EmailSink = {
  async sendImmediate() {
    /* deferred: real transport lands with the mailer */
  },
  async sendDigest() {
    /* deferred: real transport lands with the mailer */
  },
};

const prismaInboxSink: InboxSink = {
  async add() {
    // The in-app inbox table is a P8 deviation (see 20_ROADMAP.md implementation-status): it
    // reuses the existing comment row as its own inbox entry (a mention IS a comment), so there
    // is nothing further to write here — the comment create below is the durable record.
  },
};

const notifier = new MentionNotifier(logOnlyEmailSink, prismaInboxSink);

async function notifyMentions(
  boardId: string,
  commentId: string,
  authorName: string,
  body: string,
  orgId: string,
): Promise<void> {
  const handles = extractMentionHandles(body);
  if (handles.length === 0) return;
  // Resolved server-side against real members only (P8 §9) — never against the raw handle text.
  const members = await prisma.membership.findMany({
    where: { orgId },
    include: { user: true },
  });
  const byHandle = new Map(
    members.map((m) => [m.user.email.split('@')[0]?.toLowerCase(), m.userId]),
  );
  for (const handle of handles) {
    const recipientId = byHandle.get(handle);
    if (!recipientId) continue;
    await notifier.notify({
      recipientId,
      boardId,
      commentId,
      authorName,
      excerpt: body.slice(0, 200),
    });
  }
}

export const commentsRouter = router({
  list: orgProcedure('viewer')
    .input(z.object({ boardId: Id }))
    .query(async ({ ctx, input }) => {
      await assertBoardInOrg(input.boardId, ctx.org.id);
      const rows = await prisma.comment.findMany({
        where: { boardId: input.boardId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toDto);
    }),

  create: orgProcedure('editor')
    .input(
      z.object({
        boardId: Id,
        anchor: AnchorInput,
        body: z.string().trim().min(1).max(COMMENT_BODY_MAX_LENGTH),
        parentId: Id.nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBoardInOrg(input.boardId, ctx.org.id);
      if (input.parentId) {
        const parent = await prisma.comment.findFirst({
          where: { id: input.parentId, boardId: input.boardId },
          select: { id: true },
        });
        if (!parent) {
          throw new TRPCError({ code: 'NOT_FOUND', message: "That thread doesn't exist anymore." });
        }
      }
      const comment = await prisma.comment.create({
        data: {
          id: newId.comment(),
          boardId: input.boardId,
          parentId: input.parentId,
          anchor: input.anchor,
          body: input.body,
          authorId: ctx.user.id,
        },
      });
      await notifyMentions(input.boardId, comment.id, ctx.user.name, input.body, ctx.org.id);
      return toDto(comment);
    }),

  resolve: orgProcedure('editor')
    .input(z.object({ boardId: Id, commentId: Id, resolved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertBoardInOrg(input.boardId, ctx.org.id);
      const comment = await prisma.comment.update({
        where: { id: input.commentId },
        data: { resolvedAt: input.resolved ? new Date() : null },
      });
      return toDto(comment);
    }),
});
