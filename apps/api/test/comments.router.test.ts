import { describe, expect, it, vi } from 'vitest';
import { ORG_ID, ctx, prismaMock } from './prisma-mock.ts';

vi.mock('@nexus/db', () => ({ prisma: prismaMock }));

const { appRouter } = await import('../src/trpc/router.ts');
const { createCallerFactory } = await import('../src/trpc/trpc.ts');

const caller = createCallerFactory(appRouter);

const BOARD_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const COMMENT_ID = 'cccccccccccccccccccccccc';
const PARENT_ID = 'dddddddddddddddddddddddd';

const row = (over: Record<string, unknown> = {}) => ({
  id: COMMENT_ID,
  boardId: BOARD_ID,
  parentId: null,
  anchor: { kind: 'point', x: 1, y: 2 },
  body: 'hello',
  authorId: 'u1',
  resolvedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
  ...over,
});

describe('comments.list', () => {
  it('scopes to the board and orders by createdAt asc', async () => {
    prismaMock.board.findFirst.mockResolvedValue({ id: BOARD_ID });
    prismaMock.comment.findMany.mockResolvedValue([row()]);

    const result = await caller(ctx({ role: 'viewer' })).comments.list({ boardId: BOARD_ID });

    expect(prismaMock.comment.findMany).toHaveBeenCalledWith({
      where: { boardId: BOARD_ID },
      orderBy: { createdAt: 'asc' },
    });
    expect(result).toEqual([row()]);
  });

  it('throws NOT_FOUND when the board is not in the caller org', async () => {
    prismaMock.board.findFirst.mockResolvedValue(null);
    await expect(caller(ctx()).comments.list({ boardId: BOARD_ID })).rejects.toThrow(
      /no longer exists/i,
    );
    expect(prismaMock.comment.findMany).not.toHaveBeenCalled();
  });
});

describe('comments.create', () => {
  it('creates a top-level comment anchored to a point', async () => {
    prismaMock.board.findFirst.mockResolvedValue({ id: BOARD_ID });
    prismaMock.comment.create.mockResolvedValue(row());
    prismaMock.membership.findMany.mockResolvedValue([]);

    const result = await caller(ctx({ role: 'editor' })).comments.create({
      boardId: BOARD_ID,
      anchor: { kind: 'point', x: 1, y: 2 },
      body: 'hello',
    });

    const arg = prismaMock.comment.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(arg.data.boardId).toBe(BOARD_ID);
    expect(arg.data.parentId).toBeNull();
    expect(arg.data.authorId).toBe('u1');
    expect(arg.data.body).toBe('hello');
    expect(result.id).toBe(COMMENT_ID);
  });

  it('creates a reply when the parent exists on the same board', async () => {
    prismaMock.board.findFirst.mockResolvedValue({ id: BOARD_ID });
    prismaMock.comment.findFirst.mockResolvedValue({ id: PARENT_ID });
    prismaMock.comment.create.mockResolvedValue(row({ parentId: PARENT_ID }));
    prismaMock.membership.findMany.mockResolvedValue([]);

    const result = await caller(ctx({ role: 'editor' })).comments.create({
      boardId: BOARD_ID,
      anchor: { kind: 'node', nodeId: 'n1' },
      body: 'a reply',
      parentId: PARENT_ID,
    });

    expect(prismaMock.comment.findFirst).toHaveBeenCalledWith({
      where: { id: PARENT_ID, boardId: BOARD_ID },
      select: { id: true },
    });
    expect(result.parentId).toBe(PARENT_ID);
  });

  it('throws NOT_FOUND when the parent thread does not exist', async () => {
    prismaMock.board.findFirst.mockResolvedValue({ id: BOARD_ID });
    prismaMock.comment.findFirst.mockResolvedValue(null);

    await expect(
      caller(ctx({ role: 'editor' })).comments.create({
        boardId: BOARD_ID,
        anchor: { kind: 'point', x: 0, y: 0 },
        body: 'a reply',
        parentId: PARENT_ID,
      }),
    ).rejects.toThrow(/thread doesn't exist/i);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('resolves @mentions against real org members only', async () => {
    prismaMock.board.findFirst.mockResolvedValue({ id: BOARD_ID });
    prismaMock.comment.create.mockResolvedValue(row({ body: 'hi @ada' }));
    prismaMock.membership.findMany.mockResolvedValue([
      { orgId: ORG_ID, userId: 'u2', user: { email: 'ada@example.com' } },
    ]);

    await caller(ctx({ role: 'editor' })).comments.create({
      boardId: BOARD_ID,
      anchor: { kind: 'point', x: 0, y: 0 },
      body: 'hi @ada',
    });

    expect(prismaMock.membership.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG_ID },
      include: { user: true },
    });
  });

  it('skips the membership lookup entirely when the body has no mentions', async () => {
    prismaMock.board.findFirst.mockResolvedValue({ id: BOARD_ID });
    prismaMock.comment.create.mockResolvedValue(row());
    prismaMock.membership.findMany.mockClear();

    await caller(ctx({ role: 'editor' })).comments.create({
      boardId: BOARD_ID,
      anchor: { kind: 'point', x: 0, y: 0 },
      body: 'no mentions here',
    });

    expect(prismaMock.membership.findMany).not.toHaveBeenCalled();
  });

  it('denies a viewer', async () => {
    await expect(
      caller(ctx({ role: 'viewer' })).comments.create({
        boardId: BOARD_ID,
        anchor: { kind: 'point', x: 0, y: 0 },
        body: 'hi',
      }),
    ).rejects.toThrow(/access/i);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('rejects an empty body', async () => {
    await expect(
      caller(ctx({ role: 'editor' })).comments.create({
        boardId: BOARD_ID,
        anchor: { kind: 'point', x: 0, y: 0 },
        body: '',
      }),
    ).rejects.toThrow();
  });
});

describe('comments.resolve', () => {
  it('sets resolvedAt when resolving', async () => {
    prismaMock.board.findFirst.mockResolvedValue({ id: BOARD_ID });
    prismaMock.comment.update.mockResolvedValue(row({ resolvedAt: new Date('2024-02-01') }));

    const result = await caller(ctx({ role: 'editor' })).comments.resolve({
      boardId: BOARD_ID,
      commentId: COMMENT_ID,
      resolved: true,
    });

    const arg = prismaMock.comment.update.mock.calls[0]?.[0] as { data: { resolvedAt: Date } };
    expect(arg.data.resolvedAt).toBeInstanceOf(Date);
    expect(result.resolvedAt).not.toBeNull();
  });

  it('clears resolvedAt when unresolving', async () => {
    prismaMock.board.findFirst.mockResolvedValue({ id: BOARD_ID });
    prismaMock.comment.update.mockResolvedValue(row());

    await caller(ctx({ role: 'editor' })).comments.resolve({
      boardId: BOARD_ID,
      commentId: COMMENT_ID,
      resolved: false,
    });

    const arg = prismaMock.comment.update.mock.calls[0]?.[0] as { data: { resolvedAt: null } };
    expect(arg.data.resolvedAt).toBeNull();
  });

  it('throws NOT_FOUND when the board is not in the caller org', async () => {
    prismaMock.board.findFirst.mockResolvedValue(null);
    await expect(
      caller(ctx()).comments.resolve({ boardId: BOARD_ID, commentId: COMMENT_ID, resolved: true }),
    ).rejects.toThrow(/no longer exists/i);
    expect(prismaMock.comment.update).not.toHaveBeenCalled();
  });

  it('denies a viewer', async () => {
    await expect(
      caller(ctx({ role: 'viewer' })).comments.resolve({
        boardId: BOARD_ID,
        commentId: COMMENT_ID,
        resolved: true,
      }),
    ).rejects.toThrow(/access/i);
  });
});
