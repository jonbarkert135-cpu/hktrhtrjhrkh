import { describe, expect, it, vi } from 'vitest';
import { ORG_ID, PROJECT_ID, ctx, prismaMock, recordAuditMock } from './prisma-mock.js';

vi.mock('@nexus/db', () => ({ prisma: prismaMock, recordAudit: recordAuditMock }));

const { appRouter } = await import('../src/trpc/router.js');
const { createCallerFactory } = await import('../src/trpc/trpc.js');

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
      where: { projectId: PROJECT_ID, deletedAt: null },
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
