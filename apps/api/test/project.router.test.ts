import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_ID, PROJECT_ID, ctx, logger, prismaMock, recordAuditMock } from './prisma-mock.ts';

vi.mock('@nexus/db', () => ({ prisma: prismaMock, recordAudit: recordAuditMock }));

const { appRouter } = await import('../src/trpc/router.ts');
const { createCallerFactory } = await import('../src/trpc/trpc.ts');

const caller = createCallerFactory(appRouter);

const row = (over: Record<string, unknown> = {}) => ({
  id: PROJECT_ID,
  orgId: ORG_ID,
  key: 'atlas-ab12',
  name: 'Atlas',
  description: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
  ...over,
});

beforeEach(() => {
  recordAuditMock.mockResolvedValue(undefined);
});

describe('project.list', () => {
  it('scopes the query to the caller org and skips soft-deleted rows', async () => {
    prismaMock.project.findMany.mockResolvedValue([row()]);
    const result = await caller(ctx({ role: 'viewer' })).project.list({ limit: 10 });

    expect(prismaMock.project.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    expect(result).toEqual([row()]);
  });

  it('defaults the page size to 50', async () => {
    prismaMock.project.findMany.mockResolvedValue([]);
    await caller(ctx()).project.list({});
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('rejects a limit above the maximum', async () => {
    await expect(caller(ctx()).project.list({ limit: 500 })).rejects.toThrow(/less than or equal/i);
  });
});

describe('project.create', () => {
  it('derives a slug-like key from the name and writes a success audit entry', async () => {
    prismaMock.project.create.mockImplementation((args: { data: { key: string } }) =>
      Promise.resolve(row({ key: args.data.key })),
    );

    const result = await caller(ctx({ role: 'editor' })).project.create({
      name: '  Atlas Recon!! ',
      description: 'x',
    });

    const arg = prismaMock.project.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(arg.data.key).toMatch(/^atlas-recon-[a-z0-9]{4}$/);
    expect(arg.data.orgId).toBe(ORG_ID);
    expect(arg.data.createdBy).toBe('u1');
    expect(arg.data.name).toBe('Atlas Recon!!');
    expect(arg.data.description).toBe('x');
    expect(result.key).toBe(arg.data.key);

    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'project.created',
        outcome: 'success',
        actorId: 'u1',
        orgId: ORG_ID,
        targetKind: 'project',
        targetId: PROJECT_ID,
      }),
    );
  });

  it('falls back to a generic key when the name has no usable characters', async () => {
    prismaMock.project.create.mockResolvedValue(row());
    await caller(ctx({ role: 'editor' })).project.create({ name: '???' });
    const arg = prismaMock.project.create.mock.calls[0]?.[0] as { data: { key: string } };
    expect(arg.data.key).toMatch(/^project-[a-z0-9]{4}$/);
  });

  it('stores a null description when none is given', async () => {
    prismaMock.project.create.mockResolvedValue(row());
    await caller(ctx({ role: 'editor' })).project.create({ name: 'Atlas' });
    const arg = prismaMock.project.create.mock.calls[0]?.[0] as { data: { description: unknown } };
    expect(arg.data.description).toBeNull();
  });

  it('rejects an empty name without touching the database', async () => {
    await expect(caller(ctx()).project.create({ name: '   ' })).rejects.toThrow();
    expect(prismaMock.project.create).not.toHaveBeenCalled();
  });

  it('denies a viewer with FORBIDDEN and logs the denial', async () => {
    await expect(caller(ctx({ role: 'viewer' })).project.create({ name: 'Atlas' })).rejects.toThrow(
      /access/i,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'authz.denied' }),
      expect.any(String),
    );
    expect(prismaMock.project.create).not.toHaveBeenCalled();
  });

  it('still returns the project when the audit write fails', async () => {
    prismaMock.project.create.mockResolvedValue(row());
    recordAuditMock.mockRejectedValue(new Error('db down'));
    const result = await caller(ctx({ role: 'editor' })).project.create({ name: 'Atlas' });
    expect(result.id).toBe(PROJECT_ID);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'audit.write_failed' }),
      expect.any(String),
    );
  });
});

describe('project.delete', () => {
  it('soft-deletes a confirmed project and audits it', async () => {
    prismaMock.project.findFirst.mockResolvedValue(row());
    prismaMock.project.update.mockResolvedValue(row());

    const result = await caller(ctx()).project.delete({
      projectId: PROJECT_ID,
      confirmName: 'Atlas',
    });

    expect(result).toEqual({ ok: true });
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, orgId: ORG_ID, deletedAt: null },
    });
    const update = prismaMock.project.update.mock.calls[0]?.[0] as {
      data: { deletedAt: Date };
    };
    expect(update.data.deletedAt).toBeInstanceOf(Date);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.deleted', targetId: PROJECT_ID }),
    );
  });

  it('throws NOT_FOUND for a project in another org', async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    await expect(
      caller(ctx()).project.delete({ projectId: PROJECT_ID, confirmName: 'Atlas' }),
    ).rejects.toThrow(/no longer exists/i);
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when the typed name does not match', async () => {
    prismaMock.project.findFirst.mockResolvedValue(row());
    await expect(
      caller(ctx()).project.delete({ projectId: PROJECT_ID, confirmName: 'Atlaz' }),
    ).rejects.toThrow(/does not match/i);
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });

  it('rejects a malformed project id', async () => {
    await expect(
      caller(ctx()).project.delete({ projectId: 'nope', confirmName: 'Atlas' }),
    ).rejects.toThrow(/not a valid id/i);
  });

  it('denies an editor', async () => {
    await expect(
      caller(ctx({ role: 'editor' })).project.delete({
        projectId: PROJECT_ID,
        confirmName: 'Atlas',
      }),
    ).rejects.toThrow(/access/i);
  });
});
