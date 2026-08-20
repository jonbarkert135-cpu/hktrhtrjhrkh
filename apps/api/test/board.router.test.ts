import { describe, expect, it, vi } from 'vitest';
import { ORG_ID, PROJECT_ID, ctx, prismaMock, recordAuditMock } from './prisma-mock.ts';

vi.mock('@nexus/db', () => ({ prisma: prismaMock, recordAudit: recordAuditMock }));

const { appRouter } = await import('../src/trpc/router.ts');
const { createCallerFactory } = await import('../src/trpc/trpc.ts');

const caller = createCallerFactory(appRouter);

const BOARD_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const board = {
  id: BOARD_ID,
  projectId: PROJECT_ID,
  title: 'Recon',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
};

describe('board.list', () => {
  it('returns live boards of a project in the caller org', async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: PROJECT_ID });
    prismaMock.board.findMany.mockResolvedValue([board]);

    const result = await caller(ctx({ role: 'viewer' })).board.list({ projectId: PROJECT_ID });

    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, orgId: ORG_ID, deletedAt: null },
      select: { id: true },
    });
    expect(prismaMock.board.findMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, deletedAt: null, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    expect(result).toEqual([board]);
  });

  it('throws NOT_FOUND when the project belongs to another org', async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    await expect(caller(ctx()).board.list({ projectId: PROJECT_ID })).rejects.toThrow(
      /no longer exists/i,
    );
    expect(prismaMock.board.findMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed project id', async () => {
    await expect(caller(ctx()).board.list({ projectId: 'nope' })).rejects.toThrow(
      /not a valid id/i,
    );
  });
});

describe('board.create', () => {
  it('creates the board under the caller org and audits it', async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: PROJECT_ID });
    prismaMock.board.create.mockResolvedValue(board);

    const result = await caller(ctx({ role: 'editor' })).board.create({
      projectId: PROJECT_ID,
      title: '  Recon ',
    });

    const arg = prismaMock.board.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(arg.data.orgId).toBe(ORG_ID);
    expect(arg.data.projectId).toBe(PROJECT_ID);
    expect(arg.data.title).toBe('Recon');
    expect(arg.data.createdBy).toBe('u1');
    expect(result).toEqual(board);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'board.created',
        outcome: 'success',
        targetKind: 'board',
        targetId: BOARD_ID,
        orgId: ORG_ID,
      }),
    );
  });

  it('does not create a board for a project outside the org', async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    await expect(
      caller(ctx()).board.create({ projectId: PROJECT_ID, title: 'Recon' }),
    ).rejects.toThrow(/no longer exists/i);
    expect(prismaMock.board.create).not.toHaveBeenCalled();
  });

  it('rejects an empty title', async () => {
    await expect(
      caller(ctx()).board.create({ projectId: PROJECT_ID, title: '  ' }),
    ).rejects.toThrow();
  });

  it('denies a viewer', async () => {
    await expect(
      caller(ctx({ role: 'viewer' })).board.create({ projectId: PROJECT_ID, title: 'Recon' }),
    ).rejects.toThrow(/access/i);
  });
});

describe('board.rename', () => {
  it('renames a live board and audits it', async () => {
    prismaMock.board.findFirst.mockResolvedValue(board);
    prismaMock.board.update.mockResolvedValue({ ...board, title: 'Recon v2' });

    const result = await caller(ctx({ role: 'editor' })).board.rename({
      boardId: BOARD_ID,
      title: 'Recon v2',
    });

    expect(prismaMock.board.update).toHaveBeenCalledWith({
      where: { id: BOARD_ID },
      data: { title: 'Recon v2' },
    });
    expect(result.title).toBe('Recon v2');
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'board.renamed', targetId: BOARD_ID }),
    );
  });

  it('throws NOT_FOUND for a board in another org', async () => {
    prismaMock.board.findFirst.mockResolvedValue(null);
    await expect(
      caller(ctx()).board.rename({ boardId: BOARD_ID, title: 'x' }),
    ).rejects.toThrow(/no longer exists/i);
  });

  it('denies a viewer', async () => {
    await expect(
      caller(ctx({ role: 'viewer' })).board.rename({ boardId: BOARD_ID, title: 'x' }),
    ).rejects.toThrow(/access/i);
  });
});

describe('board.move', () => {
  it('moves a board into another live project of the same org', async () => {
    const otherProject = 'cccccccccccccccccccccccc';
    prismaMock.board.findFirst.mockResolvedValue(board);
    prismaMock.project.findFirst.mockResolvedValue({ id: otherProject });
    prismaMock.board.update.mockResolvedValue({ ...board, projectId: otherProject });

    const result = await caller(ctx({ role: 'editor' })).board.move({
      boardId: BOARD_ID,
      projectId: otherProject,
    });

    expect(prismaMock.board.update).toHaveBeenCalledWith({
      where: { id: BOARD_ID },
      data: { projectId: otherProject },
    });
    expect(result.projectId).toBe(otherProject);
  });

  it('refuses to move a board into a project outside the org', async () => {
    prismaMock.board.findFirst.mockResolvedValue(board);
    prismaMock.project.findFirst.mockResolvedValue(null);
    await expect(
      caller(ctx({ role: 'editor' })).board.move({ boardId: BOARD_ID, projectId: 'x'.repeat(24) }),
    ).rejects.toThrow(/no longer exists/i);
  });
});

describe('board.archive / board.restore', () => {
  it('archives then restores a board', async () => {
    prismaMock.board.findFirst.mockResolvedValue(board);
    prismaMock.board.update.mockResolvedValue({ ...board, archivedAt: new Date('2024-02-01') });
    const archived = await caller(ctx({ role: 'editor' })).board.archive({ boardId: BOARD_ID });
    expect(archived.archivedAt).not.toBeNull();
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'board.archived' }),
    );

    prismaMock.board.update.mockResolvedValue({ ...board, archivedAt: null });
    const restored = await caller(ctx({ role: 'editor' })).board.restore({ boardId: BOARD_ID });
    expect(restored.archivedAt).toBeNull();
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'board.restored' }),
    );
  });
});

describe('board.delete', () => {
  it('soft-deletes a board and audits it', async () => {
    prismaMock.board.findFirst.mockResolvedValue(board);
    prismaMock.board.update.mockResolvedValue({ ...board, deletedAt: new Date('2024-02-01') });

    const result = await caller(ctx({ role: 'editor' })).board.delete({ boardId: BOARD_ID });

    expect(result).toEqual({ ok: true });
    expect(prismaMock.board.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BOARD_ID } }),
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'board.deleted' }),
    );
  });
});

describe('board.duplicate', () => {
  it('creates a new board row pointing at the source, and audits that content was not copied', async () => {
    prismaMock.board.findFirst.mockResolvedValue(board);
    prismaMock.board.create.mockResolvedValue({ ...board, id: 'dddddddddddddddddddddddd' });

    const result = await caller(ctx({ role: 'editor' })).board.duplicate({ boardId: BOARD_ID });

    const arg = prismaMock.board.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(arg.data.templateOf).toBe(BOARD_ID);
    expect(arg.data.title).toBe('Recon copy');
    expect(result.id).not.toBe(BOARD_ID);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'board.duplicated',
        metadata: { sourceBoardId: BOARD_ID, contentCopied: false },
      }),
    );
  });
});

describe('board.saveAsTemplate', () => {
  it('flags a board reusable as a template', async () => {
    prismaMock.board.findFirst.mockResolvedValue(board);
    prismaMock.board.update.mockResolvedValue({ ...board, isTemplate: true });

    const result = await caller(ctx({ role: 'editor' })).board.saveAsTemplate({ boardId: BOARD_ID });
    expect(result.isTemplate).toBe(true);
  });
});

describe('board.touchOpened / board.reportCounts', () => {
  it('records the open time without auditing it', async () => {
    prismaMock.board.findFirst.mockResolvedValue(board);
    prismaMock.board.update.mockResolvedValue(board);
    recordAuditMock.mockClear();

    await caller(ctx({ role: 'viewer' })).board.touchOpened({ boardId: BOARD_ID });

    expect(prismaMock.board.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BOARD_ID } }),
    );
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('clamps negative or non-finite counts to zero', async () => {
    prismaMock.board.findFirst.mockResolvedValue(board);
    prismaMock.board.update.mockResolvedValue(board);

    await caller(ctx({ role: 'editor' })).board.reportCounts({
      boardId: BOARD_ID,
      nodeCount: -5,
      edgeCount: Number.POSITIVE_INFINITY,
    });

    expect(prismaMock.board.update).toHaveBeenCalledWith({
      where: { id: BOARD_ID },
      data: { nodeCount: 0, edgeCount: 0 },
    });
  });
});
