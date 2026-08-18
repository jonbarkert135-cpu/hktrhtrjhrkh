import { beforeEach, describe, expect, it, vi } from 'vitest';

// No database in unit CI: stub the env and the Prisma client module, then drive recordAudit
// against a fake client and assert on the insert it produces.
vi.mock('@nexus/config/env', () => ({
  loadServerEnv: () => ({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/raven',
    DATABASE_POOL_MAX: 5,
    LOG_LEVEL: 'error',
  }),
}));
vi.mock('@prisma/client', () => ({ PrismaClient: class {} }));

const { recordAudit } = await import('../src/audit');
const dbModule = await import('../src/index');
const { fixedClock, isId } = await import('@nexus/domain');

type Created = { data: Record<string, unknown> };

let created: Created[] = [];
const db = {
  auditLog: {
    create: vi.fn(async (args: Created) => {
      created.push(args);
      return args.data;
    }),
  },
};

beforeEach(() => {
  created = [];
  db.auditLog.create.mockClear();
});

describe('recordAudit', () => {
  it('inserts a complete row with a generated id and server time', async () => {
    const clock = fixedClock(new Date('2026-02-01T10:00:00.000Z'));
    const id = await recordAudit(
      {
        orgId: 'org_1',
        action: 'project.created',
        outcome: 'success',
        targetKind: 'project',
        targetId: 'prj_1',
        actorId: 'usr_1',
        ip: '10.0.0.1',
        userAgent: 'vitest',
        metadata: { name: 'Alpha' },
      },
      { db: db as never, clock },
    );

    expect(isId(id)).toBe(true);
    const row = created[0]?.data;
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'action',
      'actorId',
      'actorKind',
      'createdAt',
      'id',
      'ip',
      'metadata',
      'orgId',
      'outcome',
      'targetId',
      'targetKind',
      'updatedAt',
      'userAgent',
    ]);
    expect(row?.id).toBe(id);
    expect(row?.actorKind).toBe('user');
    expect(row?.createdAt).toEqual(clock.now());
    // append-only: the row is born with updatedAt === createdAt and never edited
    expect(row?.updatedAt).toEqual(row?.createdAt);
  });

  it('defaults optional fields instead of writing undefined', async () => {
    await recordAudit(
      { orgId: 'org_1', action: 'auth.login_failed', outcome: 'denied', targetKind: 'user' },
      { db: db as never, clock: fixedClock(1) },
    );
    const row = created[0]?.data;
    expect(row?.actorId).toBeNull();
    expect(row?.actorKind).toBe('system');
    expect(row?.metadata).toEqual({});
  });

  it('exposes no update or delete path for audit rows', () => {
    const exported = Object.keys(dbModule);
    expect(exported).toContain('recordAudit');
    expect(exported.filter((k) => /audit/i.test(k))).toEqual(['recordAudit']);
    expect(exported.some((k) => /(update|delete|remove|purge)/i.test(k))).toBe(false);
  });
});
