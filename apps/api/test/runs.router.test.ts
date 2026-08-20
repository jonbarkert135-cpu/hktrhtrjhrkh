import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_ID, PROJECT_ID, ctx, prismaMock, recordAuditMock } from './prisma-mock.ts';

vi.mock('@nexus/db', () => ({ prisma: prismaMock, recordAudit: recordAuditMock }));

const enqueueRun = vi.fn();
const requestRunCancel = vi.fn();
const publishRunEvent = vi.fn();
vi.mock('../src/integrations/queue.ts', () => ({
  enqueueRun: (...args: unknown[]) => enqueueRun(...args),
  requestRunCancel: (...args: unknown[]) => requestRunCancel(...args),
  publishRunEvent: (...args: unknown[]) => publishRunEvent(...args),
}));

const applyProposalRemotely = vi.fn();
vi.mock('../src/integrations/applyProposal.ts', () => ({
  applyProposalRemotely: (...args: unknown[]) => applyProposalRemotely(...args),
}));

const { appRouter } = await import('../src/trpc/router.ts');
const { createCallerFactory } = await import('../src/trpc/trpc.ts');
const { builtinRegistry, hashText, targetsHash } = await import('@nexus/integrations');

const caller = createCallerFactory(appRouter);
const manifest = builtinRegistry().entries.values().next().value!.manifest;
const BOARD_ID = 'b1';
const targets = [
  { kind: 'url' as const, value: 'https://sho.rt/x', scope: 'public-index' as const },
];

const consentRow = (over: Record<string, unknown> = {}) => ({
  id: 'consent-1',
  orgId: ORG_ID,
  projectId: PROJECT_ID,
  userId: 'u1',
  integrationId: manifest.id,
  scope: 'public-index',
  targetsHash: targetsHash(targets),
  scopeTextHash: hashText(manifest.consent.scopeText),
  acceptedAt: new Date('2026-02-01T00:00:00.000Z'),
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  revokedAt: null,
  usedAt: null,
  ...over,
});

const startInput = (over: Record<string, unknown> = {}) => ({
  integrationId: manifest.id,
  projectId: PROJECT_ID,
  boardId: BOARD_ID,
  input: { url: 'https://sho.rt/x' },
  targets,
  consentToken: 'consent-1',
  ...over,
});

beforeEach(() => {
  recordAuditMock.mockResolvedValue(undefined);
  prismaMock.consent.findFirst.mockResolvedValue(consentRow());
  prismaMock.integrationRun.count.mockResolvedValue(0);
  prismaMock.integrationRun.findFirst.mockResolvedValue(null);
  prismaMock.integrationRun.create.mockImplementation((args: { data: { id: string } }) =>
    Promise.resolve({ ...args.data, createdAt: new Date() }),
  );
  prismaMock.integrationRun.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.consent.update.mockResolvedValue(consentRow());
});

describe('runs.start (§7, §12)', () => {
  it('queues a run and audits the request', async () => {
    const result = await caller(ctx({ role: 'editor' })).runs.start(startInput());
    expect(result.reused).toBe(false);
    expect(enqueueRun).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_ID, attempt: 1 }));
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.run.requested', outcome: 'success' }),
    );
    // The input is stored redacted and hashed for dedupe.
    const created = prismaMock.integrationRun.create.mock.calls[0]?.[0] as {
      data: { inputHash: string };
    };
    expect(created.data.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses a run with no consent at all', async () => {
    prismaMock.consent.findFirst.mockResolvedValue(null);
    await expect(caller(ctx({ role: 'editor' })).runs.start(startInput())).rejects.toThrow(
      /CONSENT_REQUIRED/,
    );
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it('refuses an expired consent and a tampered target set', async () => {
    prismaMock.consent.findFirst.mockResolvedValue(
      consentRow({ expiresAt: new Date('2020-01-01') }),
    );
    await expect(caller(ctx({ role: 'editor' })).runs.start(startInput())).rejects.toThrow(
      /CONSENT_EXPIRED/,
    );

    prismaMock.consent.findFirst.mockResolvedValue(consentRow());
    await expect(
      caller(ctx({ role: 'editor' })).runs.start(
        startInput({
          targets: [{ kind: 'url', value: 'https://elsewhere.test/', scope: 'public-index' }],
        }),
      ),
    ).rejects.toThrow(/CONSENT_EXPIRED/);
  });

  it('refuses a target scope the org policy does not allow', async () => {
    prismaMock.consent.findFirst.mockResolvedValue(consentRow({ scope: 'third-party-host' }));
    await expect(
      caller(ctx({ role: 'editor' })).runs.start(
        startInput({
          targets: [{ kind: 'url', value: 'https://sho.rt/x', scope: 'third-party-host' }],
        }),
      ),
    ).rejects.toThrow(/CONSENT_EXPIRED|TARGET_NOT_ALLOWED/);
  });

  it('enforces the per-user hourly quota and the concurrency semaphore', async () => {
    prismaMock.integrationRun.count.mockResolvedValueOnce(manifest.rateLimits.perUserPerHour);
    await expect(caller(ctx({ role: 'editor' })).runs.start(startInput())).rejects.toThrow(
      /QUOTA_EXCEEDED/,
    );

    prismaMock.integrationRun.count.mockReset();
    prismaMock.integrationRun.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(manifest.rateLimits.concurrentRunsPerOrg);
    await expect(caller(ctx({ role: 'editor' })).runs.start(startInput())).rejects.toThrow(
      /CONCURRENCY_LIMIT/,
    );
  });

  it('reuses a recent identical run instead of hitting the target twice', async () => {
    prismaMock.integrationRun.findFirst.mockResolvedValue({ id: 'run-old', createdAt: new Date() });
    const result = await caller(ctx({ role: 'editor' })).runs.start(startInput());
    expect(result).toMatchObject({ runId: 'run-old', reused: true });
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it('starts a new run anyway when the user forces it', async () => {
    prismaMock.integrationRun.findFirst.mockResolvedValue({ id: 'run-old', createdAt: new Date() });
    const result = await caller(ctx({ role: 'editor' })).runs.start(startInput({ force: true }));
    expect(result.reused).toBe(false);
    expect(enqueueRun).toHaveBeenCalled();
  });

  it('refuses a viewer', async () => {
    await expect(caller(ctx({ role: 'viewer' })).runs.start(startInput())).rejects.toThrow(
      /access/i,
    );
  });

  it('refuses an unknown integration', async () => {
    await expect(
      caller(ctx({ role: 'editor' })).runs.start(startInput({ integrationId: 'not-installed' })),
    ).rejects.toThrow(/not installed/);
  });
});

describe('runs.get / list / log / cancel', () => {
  const run = {
    id: 'run-1',
    orgId: ORG_ID,
    integrationId: manifest.id,
    boardId: BOARD_ID,
    status: 'running',
    stats: {},
    artifacts: [],
    errorCode: null,
    errorDetail: null,
    startedAt: new Date(),
    finishedAt: null,
    durationMs: null,
    proposalId: null,
    parentRunId: null,
    inputHash: 'x',
    createdAt: new Date(),
  };

  it('scopes every read to the caller org and 404s otherwise', async () => {
    prismaMock.integrationRun.findFirst.mockResolvedValue(null);
    await expect(caller(ctx()).runs.get({ runId: 'run-1' })).rejects.toThrow(/no longer exists/);
    expect(prismaMock.integrationRun.findFirst).toHaveBeenCalledWith({
      where: { id: 'run-1', orgId: ORG_ID },
    });
  });

  it('returns the run record', async () => {
    prismaMock.integrationRun.findFirst.mockResolvedValue(run);
    await expect(caller(ctx()).runs.get({ runId: 'run-1' })).resolves.toMatchObject({
      id: 'run-1',
      status: 'running',
    });
  });

  it('pages history newest-first with a cursor', async () => {
    prismaMock.integrationRun.findMany.mockResolvedValue([run, { ...run, id: 'run-2' }]);
    const page = await caller(ctx()).runs.list({ boardId: BOARD_ID, limit: 1 });
    expect(page.runs).toHaveLength(1);
    expect(page.nextCursor).toBe('run-1');
    expect(prismaMock.integrationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('returns log entries in sequence order', async () => {
    prismaMock.integrationRun.findFirst.mockResolvedValue(run);
    prismaMock.runLogEntry.findMany.mockResolvedValue([
      { seq: 0, at: new Date(), level: 'info', phase: 'start', message: 'claimed', data: null },
    ]);
    const entries = await caller(ctx()).runs.log({ runId: 'run-1', afterSeq: 0 });
    expect(entries[0]?.phase).toBe('start');
  });

  it('cancels through Redis and audits it, and is a no-op on a finished run', async () => {
    prismaMock.integrationRun.findFirst.mockResolvedValue(run);
    const result = await caller(ctx({ role: 'editor' })).runs.cancel({ runId: 'run-1' });
    expect(result).toEqual({ status: 'cancelled', cancelled: true });
    expect(requestRunCancel).toHaveBeenCalledWith('run-1', 900_000);

    prismaMock.integrationRun.findFirst.mockResolvedValue({ ...run, status: 'succeeded' });
    await expect(caller(ctx({ role: 'editor' })).runs.cancel({ runId: 'run-1' })).resolves.toEqual({
      status: 'succeeded',
      cancelled: false,
    });
  });
});

describe('proposals.get / apply', () => {
  const proposal = {
    id: 'proposal-1',
    orgId: ORG_ID,
    boardId: BOARD_ID,
    expiresAt: new Date('2030-01-01'),
    appliedItems: {},
    payload: { id: 'proposal-1', items: [], summary: {} },
  };

  it('refuses an expired proposal with the canonical code', async () => {
    prismaMock.importProposal.findFirst.mockResolvedValue({
      ...proposal,
      expiresAt: new Date('2020-01-01'),
    });
    await expect(caller(ctx()).proposals.get({ proposalId: 'proposal-1' })).rejects.toThrow(
      /PROPOSAL_EXPIRED/,
    );
  });

  it('applies through apps/sync and records what was applied', async () => {
    prismaMock.importProposal.findFirst.mockResolvedValue(proposal);
    prismaMock.importProposal.update.mockResolvedValue(proposal);
    applyProposalRemotely.mockResolvedValue({
      createdNodeIds: ['n1'],
      createdEdgeIds: [],
      patchedNodeIds: [],
      undoStackEntryId: 'x',
      skipped: [],
      tempIdMap: { 'n:1': 'n1' },
      label: 'Import',
    });

    const result = await caller(ctx({ role: 'editor' })).proposals.applySelected({
      proposalId: 'proposal-1',
      selectedItemIds: ['n:1'],
      conflictResolutions: {},
    });

    expect(result.createdNodeIds).toEqual(['n1']);
    expect(applyProposalRemotely).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: BOARD_ID }),
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.proposal.applied' }),
    );
  });

  it('refuses a viewer', async () => {
    await expect(
      caller(ctx({ role: 'viewer' })).proposals.applySelected({
        proposalId: 'p',
        selectedItemIds: [],
        conflictResolutions: {},
      }),
    ).rejects.toThrow(/access/i);
  });
});

describe('integrations.list (R1)', () => {
  it('always offers the builtin example and hides digests from non-admins', async () => {
    const asViewer = await caller(ctx({ role: 'viewer' })).integrations.list();
    expect(asViewer.integrations.length).toBeGreaterThan(0);
    expect(asViewer.integrations.every((entry) => entry.imageDigest === null)).toBe(true);
    expect(asViewer.rejected).toEqual([]);
  });
});
