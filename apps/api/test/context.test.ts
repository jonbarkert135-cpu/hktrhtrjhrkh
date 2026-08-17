import { describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { logger, prismaMock, recordAuditMock } from './prisma-mock.ts';

vi.mock('@nexus/db', () => ({ prisma: prismaMock, recordAudit: recordAuditMock }));

const { createContextFactory, toHeaders } = await import('../src/trpc/context.ts');
const { appRouter } = await import('../src/trpc/router.ts');
const { createCallerFactory, hasRole } = await import('../src/trpc/trpc.ts');
const { audit } = await import('../src/audit.ts');
import type { Auth } from '../src/auth/index.ts';

const req = (headers: Record<string, string | string[] | undefined> = {}) =>
  ({ headers, id: 'req-1', ip: '127.0.0.1', log: logger }) as unknown as FastifyRequest;

const factory = (session: unknown) =>
  createContextFactory({
    api: { getSession: vi.fn().mockResolvedValue(session) },
  } as unknown as Auth);

const SESSION = { user: { id: 'u1', email: 'a@example.com', name: 'A' } };

describe('toHeaders', () => {
  it('copies string headers and appends every value of an array header', () => {
    const headers = toHeaders(req({ cookie: 'a=1', 'x-multi': ['1', '2'], 'x-drop': undefined }));
    expect(headers.get('cookie')).toBe('a=1');
    expect(headers.get('x-multi')).toBe('1, 2');
    expect(headers.has('x-drop')).toBe(false);
  });
});

describe('createContext', () => {
  it('returns an anonymous context when there is no session', async () => {
    const ctx = await factory(null)({ req: req(), res: {} as FastifyReply });
    expect(ctx).toMatchObject({ user: null, org: null, role: null, req_id: 'req-1' });
    expect(prismaMock.membership.findFirst).not.toHaveBeenCalled();
  });

  it('resolves the user, their first org and their role', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({
      role: 'admin',
      org: { id: 'o1', name: 'Org', slug: 'org' },
    });
    const ctx = await factory(SESSION)({ req: req(), res: {} as FastifyReply });

    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { createdAt: 'asc' },
      include: { org: true },
    });
    expect(ctx.user).toEqual({ id: 'u1', email: 'a@example.com', name: 'A' });
    expect(ctx.org).toEqual({ id: 'o1', name: 'Org', slug: 'org' });
    expect(ctx.role).toBe('admin');
  });

  it('falls back to the email as the name and to a null org without a membership', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null);
    const ctx = await factory({ user: { id: 'u1', email: 'a@example.com', name: null } })({
      req: req(),
      res: {} as FastifyReply,
    });
    expect(ctx.user?.name).toBe('a@example.com');
    expect(ctx.org).toBeNull();
    expect(ctx.role).toBeNull();
  });
});

describe('role ranking', () => {
  it('accepts a role at or above the minimum and rejects below it or none', () => {
    expect(hasRole('admin', 'editor')).toBe(true);
    expect(hasRole('editor', 'editor')).toBe(true);
    expect(hasRole('viewer', 'editor')).toBe(false);
    expect(hasRole(null, 'viewer')).toBe(false);
  });
});

describe('error formatter', () => {
  it('adds the tRPC code and the req_id from the context', () => {
    const config = appRouter._def._config;
    const shape = config.errorFormatter({
      shape: { message: 'no', code: -32001, data: {} },
      error: new TRPCError({ code: 'FORBIDDEN' }),
      ctx: { req_id: 'req-1' },
      type: 'query',
      path: 'project.list',
      input: undefined,
    } as unknown as Parameters<typeof config.errorFormatter>[0]) as {
      data: { code: string; req_id: string | null };
    };
    expect(shape.data.code).toBe('FORBIDDEN');
    expect(shape.data.req_id).toBe('req-1');
  });

  it('reports a null req_id when there is no context', () => {
    const config = appRouter._def._config;
    const shape = config.errorFormatter({
      shape: { message: 'no', code: -32001, data: {} },
      error: new TRPCError({ code: 'UNAUTHORIZED' }),
      ctx: undefined,
      type: 'query',
      path: 'auth.session',
      input: undefined,
    } as unknown as Parameters<typeof config.errorFormatter>[0]) as {
      data: { req_id: string | null };
    };
    expect(shape.data.req_id).toBeNull();
  });
});

describe('audit', () => {
  const entry = {
    action: 'auth.login' as const,
    outcome: 'success' as const,
    actorId: 'u1',
    targetKind: 'user',
    targetId: 'u1',
    ip: '127.0.0.1',
  };

  it('writes the entry when an org is known', async () => {
    await audit({ ...entry, orgId: 'o1' }, logger);
    expect(recordAuditMock).toHaveBeenCalledWith({ ...entry, orgId: 'o1' });
  });

  it('logs and skips the write when the event has no org', async () => {
    await audit({ ...entry, orgId: null }, logger);
    expect(recordAuditMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'audit.skipped' }),
      expect.any(String),
    );
  });

  it('swallows a failing write', async () => {
    recordAuditMock.mockRejectedValue(new Error('db down'));
    await expect(audit({ ...entry, orgId: 'o1' }, logger)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'audit.write_failed', action: 'auth.login' }),
      expect.any(String),
    );
  });
});

describe('protected procedures', () => {
  it('rejects an anonymous caller with UNAUTHORIZED', async () => {
    const caller = createCallerFactory(appRouter)({
      user: null,
      org: null,
      role: null,
      req_id: 'req-1',
      ip: '127.0.0.1',
      logger,
    });
    await expect(caller.project.list({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a signed-in caller without an org with FORBIDDEN', async () => {
    const caller = createCallerFactory(appRouter)({
      user: { id: 'u1', email: 'a@example.com', name: 'A' },
      org: null,
      role: 'owner',
      req_id: 'req-1',
      ip: '127.0.0.1',
      logger,
    });
    await expect(caller.project.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
