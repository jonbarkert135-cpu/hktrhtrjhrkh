import { describe, expect, it, vi } from 'vitest';

vi.mock('@nexus/db', () => ({ prisma: {}, recordAudit: vi.fn() }));

const { appRouter } = await import('../src/trpc/router.ts');
const { createCallerFactory } = await import('../src/trpc/trpc.ts');
import type { Context } from '../src/trpc/context.ts';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const anonymous: Context = {
  user: null,
  org: null,
  role: null,
  req_id: 'req-1',
  ip: '127.0.0.1',
  logger,
};
const signedIn: Context = {
  ...anonymous,
  user: { id: 'u1', email: 'a@example.com', name: 'A' },
  org: { id: 'o1', name: 'Org', slug: 'org' },
  role: 'editor',
};

const caller = createCallerFactory(appRouter);

describe('auth.session', () => {
  it('returns a null user for an anonymous caller', async () => {
    const result = await caller(anonymous).auth.session();
    expect(result.user).toBeNull();
    expect(result.org).toBeNull();
    expect(result.role).toBeNull();
  });

  it('returns the user, org and role for a signed-in caller', async () => {
    const result = await caller(signedIn).auth.session();
    expect(result.user?.email).toBe('a@example.com');
    expect(result.org?.id).toBe('o1');
    expect(result.role).toBe('editor');
  });

  it('rejects org procedures for an anonymous caller', async () => {
    await expect(caller(anonymous).project.list({})).rejects.toThrow(/session has expired/i);
  });

  it('rejects org procedures when the role is too low', async () => {
    const viewer: Context = { ...signedIn, role: 'viewer' };
    await expect(caller(viewer).project.create({ name: 'x' })).rejects.toThrow(/access/i);
  });
});
