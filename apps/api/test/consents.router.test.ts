import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_ID, PROJECT_ID, ctx, prismaMock, recordAuditMock } from './prisma-mock.ts';

vi.mock('@nexus/db', () => ({ prisma: prismaMock, recordAudit: recordAuditMock }));

const { appRouter } = await import('../src/trpc/router.ts');
const { createCallerFactory } = await import('../src/trpc/trpc.ts');
const { builtinRegistry, hashText, targetsHash } = await import('@nexus/integrations');

const caller = createCallerFactory(appRouter);
const manifest = builtinRegistry().entries.values().next().value!.manifest;

const targets = [
  { kind: 'url' as const, value: 'https://sho.rt/x', scope: 'public-index' as const },
];

const acceptInput = (over: Record<string, unknown> = {}) => ({
  projectId: PROJECT_ID,
  integrationId: manifest.id,
  scope: 'public-index' as const,
  targets,
  scopeText: manifest.consent.scopeText,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  recordAuditMock.mockResolvedValue(undefined);
});

describe('consents.accept', () => {
  it('records the acceptance and returns the token runs.start requires', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');
    prismaMock.consent.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ ...data, expiresAt }),
    );

    const result = await caller(ctx({ role: 'editor' })).consents.accept(acceptInput());

    const created = prismaMock.consent.create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(created.orgId).toBe(ORG_ID);
    expect(created.projectId).toBe(PROJECT_ID);
    expect(created.userId).toBe('u1');
    expect(created.integrationId).toBe(manifest.id);
    expect(created.targetsHash).toBe(targetsHash(targets));
    // The wording is stored hashed, never verbatim: it is evidence, not content.
    expect(created.scopeTextHash).toBe(hashText(manifest.consent.scopeText));
    expect(created.ip).toBe('127.0.0.1');
    expect(result).toEqual({ consentToken: created.id, expiresAt });
  });

  it('never records a consent that outlives its acceptance', async () => {
    prismaMock.consent.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => data,
    );

    await caller(ctx({ role: 'editor' })).consents.accept(acceptInput());

    const created = prismaMock.consent.create.mock.calls[0]?.[0].data as {
      acceptedAt: Date;
      expiresAt: Date;
    };
    expect(created.expiresAt.getTime()).toBeGreaterThan(created.acceptedAt.getTime());
  });

  it('writes an audit entry pointing at the stored consent', async () => {
    prismaMock.consent.create.mockResolvedValue({
      id: 'consent-9',
      scopeTextHash: hashText(manifest.consent.scopeText),
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });

    await caller(ctx({ role: 'editor' })).consents.accept(acceptInput());

    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.consent.accepted',
        outcome: 'success',
        targetKind: 'consent',
        targetId: 'consent-9',
      }),
    );
  });

  it('rejects an integration that is not installed', async () => {
    await expect(
      caller(ctx({ role: 'editor' })).consents.accept(acceptInput({ integrationId: 'nope' })),
    ).rejects.toThrow(/not installed/i);
    expect(prismaMock.consent.create).not.toHaveBeenCalled();
  });

  it('refuses wording that does not match the manifest', async () => {
    await expect(
      caller(ctx({ role: 'editor' })).consents.accept(
        acceptInput({ scopeText: 'Some other wording the user was shown instead.' }),
      ),
    ).rejects.toThrow(/wording changed/i);
    expect(prismaMock.consent.create).not.toHaveBeenCalled();
  });

  it('rejects a viewer: accepting is a write', async () => {
    await expect(caller(ctx({ role: 'viewer' })).consents.accept(acceptInput())).rejects.toThrow();
    expect(prismaMock.consent.create).not.toHaveBeenCalled();
  });
});

describe('consents.list', () => {
  it('returns only the caller own consents, newest first, without the hashes', async () => {
    prismaMock.consent.findMany.mockResolvedValue([
      {
        id: 'consent-1',
        integrationId: manifest.id,
        scope: 'public-index',
        acceptedAt: new Date('2026-02-01T00:00:00.000Z'),
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        revokedAt: null,
        scopeTextHash: 'secret-hash',
        targetsHash: 'secret-hash',
      },
    ]);

    const rows = await caller(ctx({ role: 'viewer' })).consents.list({});

    expect(prismaMock.consent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: ORG_ID, userId: 'u1' },
        orderBy: { acceptedAt: 'desc' },
        take: 100,
      }),
    );
    expect(rows[0]).not.toHaveProperty('scopeTextHash');
    expect(rows[0]?.id).toBe('consent-1');
  });

  it('narrows to one project when asked', async () => {
    prismaMock.consent.findMany.mockResolvedValue([]);
    await caller(ctx({ role: 'viewer' })).consents.list({ projectId: PROJECT_ID });
    expect(prismaMock.consent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: ORG_ID, userId: 'u1', projectId: PROJECT_ID },
      }),
    );
  });
});

describe('consents.revoke', () => {
  it('marks the consent revoked and cancels the runs leaning on it', async () => {
    prismaMock.consent.findFirst.mockResolvedValue({ id: 'consent-1' });
    prismaMock.consent.update.mockResolvedValue({});
    prismaMock.integrationRun.updateMany.mockResolvedValue({ count: 2 });

    const result = await caller(ctx({ role: 'editor' })).consents.revoke({
      consentId: 'consent-1',
    });

    expect(prismaMock.consent.update).toHaveBeenCalledWith({
      where: { id: 'consent-1' },
      data: { revokedAt: result.revokedAt },
    });
    // Only work that has not contacted anyone yet can still be stopped.
    expect(prismaMock.integrationRun.updateMany).toHaveBeenCalledWith({
      where: { consentId: 'consent-1', status: { in: ['queued', 'awaiting_approval'] } },
      data: {
        status: 'cancelled',
        errorCode: 'CONSENT_EXPIRED',
        finishedAt: result.revokedAt,
      },
    });
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.consent.revoked', targetId: 'consent-1' }),
    );
  });

  it('throws NOT_FOUND for a consent belonging to someone else', async () => {
    prismaMock.consent.findFirst.mockResolvedValue(null);
    await expect(
      caller(ctx({ role: 'editor' })).consents.revoke({ consentId: 'consent-1' }),
    ).rejects.toThrow(/no longer exists/i);
    expect(prismaMock.integrationRun.updateMany).not.toHaveBeenCalled();
  });
});
