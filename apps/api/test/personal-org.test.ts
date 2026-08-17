import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from './prisma-mock.ts';

vi.mock('@nexus/db', () => ({ prisma: prismaMock }));

const { ensurePersonalOrg, personalOrgName, personalOrgSlug } = await import(
  '../src/auth/personal-org.ts'
);

const user = { id: 'u1', email: 'Ada@example.com', name: 'Ada Lovelace' };

beforeEach(() => {
  prismaMock.membership.findFirst.mockReset();
  prismaMock.membership.create.mockReset();
  prismaMock.organization.create.mockReset();
});

describe('personalOrgName', () => {
  it('uses the display name', () => {
    expect(personalOrgName(user)).toBe("Ada Lovelace's workspace");
  });

  it('falls back to the email local part when the name is blank or missing', () => {
    expect(personalOrgName({ id: 'u1', email: 'ada@example.com', name: '  ' })).toBe(
      "ada's workspace",
    );
    expect(personalOrgName({ id: 'u1', email: 'ada@example.com' })).toBe("ada's workspace");
  });
});

describe('personalOrgSlug', () => {
  it('slugifies the email local part and appends the suffix', () => {
    expect(personalOrgSlug(user, 'abc123')).toBe('ada-abc123');
    expect(personalOrgSlug({ id: 'u1', email: 'a.b+c@example.com' }, 'zz')).toBe('a-b-c-zz');
  });

  it('never produces a bare suffix when the local part has no usable characters', () => {
    expect(personalOrgSlug({ id: 'u1', email: '+++@example.com' }, 'zz')).toBe('workspace-zz');
  });

  it('generates a random suffix by default', () => {
    expect(personalOrgSlug(user)).toMatch(/^ada-[a-z0-9]+$/);
  });
});

describe('ensurePersonalOrg', () => {
  it('creates an org the user owns and reports it as created', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null);
    prismaMock.organization.create.mockResolvedValue({ id: 'o-new' });
    prismaMock.membership.create.mockResolvedValue({ id: 'm-new' });

    const result = await ensurePersonalOrg(user);

    expect(result).toEqual({ orgId: 'o-new', created: true });
    expect(prismaMock.organization.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Ada Lovelace's workspace" }),
    });
    expect(prismaMock.membership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orgId: 'o-new', userId: 'u1', role: 'owner' }),
    });
  });

  it('is idempotent: an existing membership is reused, nothing is created', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ orgId: 'o-old' });

    const result = await ensurePersonalOrg(user);

    expect(result).toEqual({ orgId: 'o-old', created: false });
    expect(prismaMock.organization.create).not.toHaveBeenCalled();
    expect(prismaMock.membership.create).not.toHaveBeenCalled();
  });
});
