/**
 * REST v1 (10_INTEGRATIONS.md §10): the token surface must resolve the caller, enforce scopes and
 * then run the *same* tRPC procedures — never a second policy.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_ID, prismaMock } from './prisma-mock.ts';

vi.mock('@nexus/db', () => ({ prisma: prismaMock, recordAudit: vi.fn() }));

// argon2id costs ~0.5 s per verification by design; apiToken.test.ts owns that guarantee. Here the
// hash is stubbed with a cheap deterministic digest so eleven authenticated requests stay well
// inside the 5 s unit-test budget while resolveToken's real logic still runs.
vi.mock('@noble/hashes/argon2.js', async () => {
  const { sha256 } = await import('@noble/hashes/sha2.js');
  return {
    argon2id: (password: Uint8Array, salt: Uint8Array) =>
      sha256(new Uint8Array([...password, ...salt])),
  };
});

const presignGet = vi.fn();
vi.mock('../src/files/storage.ts', () => ({ getStorage: () => ({ presignGet }) }));

const caller = {
  integrations: { list: vi.fn() },
  consents: { accept: vi.fn() },
  runs: { start: vi.fn(), list: vi.fn(), get: vi.fn(), log: vi.fn(), cancel: vi.fn() },
  proposals: { get: vi.fn(), applySelected: vi.fn() },
};
const createCaller = vi.fn(() => caller);
const contexts: unknown[] = [];
vi.mock('../src/trpc/router.ts', () => ({ appRouter: {} }));
vi.mock('../src/trpc/trpc.ts', () => ({
  createCallerFactory: () => (context: unknown) => {
    contexts.push(context);
    return createCaller();
  },
}));

const { hashToken } = await import('../src/auth/apiToken.ts');
const { restV1Plugin, PRESIGN_TTL_SECONDS } = await import('../src/rest/v1.ts');

const PLAINTEXT = 'nxs_abcdefghijklmnopqrstuvwxyz012345';
const HASH = hashToken(PLAINTEXT);
const auth = { authorization: `Bearer ${PLAINTEXT}` };

const tokenRow = (over: Record<string, unknown> = {}) => ({
  id: 'token-1',
  orgId: ORG_ID,
  userId: 'u1',
  hash: HASH,
  scopes: ['runs:read', 'runs:start', 'proposals:read', 'proposals:apply'],
  expiresAt: null,
  revokedAt: null,
  ...over,
});

const build = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });
  await app.register(restV1Plugin);
  await app.ready();
  return app;
};

beforeEach(() => {
  contexts.length = 0;
  prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow());
  prismaMock.apiToken.update.mockResolvedValue(tokenRow());
  prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
  prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@example.com', name: 'A' });
  prismaMock.organization.findUnique.mockResolvedValue({ id: ORG_ID, name: 'Org', slug: 'org' });
  caller.runs.get.mockResolvedValue({ artifacts: [{ key: 'runs/r1/result.json' }] });
});

describe('authentication', () => {
  it('rejects a missing or malformed bearer token with 401', async () => {
    const app = await build();

    for (const headers of [{}, { authorization: 'Token nope' }, { authorization: 'Bearer nope' }]) {
      const res = await app.inject({ method: 'GET', url: '/v1/runs', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'unauthorized' });
    }
    expect(prismaMock.apiToken.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an unknown or wrong secret with 401 and does not leak which', async () => {
    prismaMock.apiToken.findUnique.mockResolvedValue(null);
    const app = await build();

    const res = await app.inject({ method: 'GET', url: '/v1/runs', headers: auth });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('This token cannot be used.');
    await app.close();
  });

  it('answers 403 for a caller who lost their membership', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null);
    const app = await build();

    const res = await app.inject({ method: 'GET', url: '/v1/runs', headers: auth });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('stamps lastUsedAt and builds the caller context from the token owner', async () => {
    caller.runs.list.mockResolvedValue({ items: [] });
    const app = await build();

    await app.inject({ method: 'GET', url: '/v1/runs', headers: auth });

    expect(prismaMock.apiToken.update).toHaveBeenCalledWith({
      where: { id: 'token-1' },
      data: { lastUsedAt: expect.any(Date) as Date },
    });
    expect(contexts[0]).toMatchObject({
      user: { id: 'u1' },
      org: { id: ORG_ID },
      role: 'admin',
    });
    await app.close();
  });

  it('refuses a scope the token does not carry, with 403', async () => {
    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow({ scopes: ['runs:read'] }));
    const app = await build();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: auth,
      payload: { integrationId: 'expand-url' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/runs:start/);
    expect(caller.runs.start).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('routes', () => {
  it('forwards each read route to its tRPC procedure', async () => {
    caller.integrations.list.mockResolvedValue([{ id: 'expand-url' }]);
    caller.runs.list.mockResolvedValue({ items: [{ id: 'r1' }] });
    caller.runs.log.mockResolvedValue({ entries: [] });
    caller.proposals.get.mockResolvedValue({ id: 'p1' });
    const app = await build();

    expect((await app.inject({ url: '/v1/integrations', headers: auth })).json()).toEqual([
      { id: 'expand-url' },
    ]);
    await app.inject({ url: '/v1/runs?status=running', headers: auth });
    expect(caller.runs.list).toHaveBeenCalledWith({ status: 'running' });
    await app.inject({ url: '/v1/runs/r1', headers: auth });
    expect(caller.runs.get).toHaveBeenCalledWith({ runId: 'r1' });
    await app.inject({ url: '/v1/runs/r1/log', headers: auth });
    expect(caller.runs.log).toHaveBeenCalledWith({ runId: 'r1', afterSeq: 0 });
    await app.inject({ url: '/v1/proposals/p1', headers: auth });
    expect(caller.proposals.get).toHaveBeenCalledWith({ proposalId: 'p1' });
    await app.close();
  });

  it('accepts a consent and answers 202 for a started run', async () => {
    caller.consents.accept.mockResolvedValue({ consentToken: 'c1' });
    caller.runs.start.mockResolvedValue({ runId: 'r1' });
    const app = await build();

    const consent = await app.inject({
      method: 'POST',
      url: '/v1/consents',
      headers: auth,
      payload: { integrationId: 'expand-url' },
    });
    expect(consent.json()).toEqual({ consentToken: 'c1' });

    const run = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: auth,
      payload: { integrationId: 'expand-url', consentToken: 'c1' },
    });
    expect(run.statusCode).toBe(202);
    expect(run.json()).toEqual({ runId: 'r1' });
    await app.close();
  });

  it('cancels a run through the same procedure the UI uses', async () => {
    caller.runs.cancel.mockResolvedValue({ status: 'cancelled' });
    const app = await build();

    const res = await app.inject({ method: 'POST', url: '/v1/runs/r1/cancel', headers: auth });
    expect(res.json()).toEqual({ status: 'cancelled' });
    expect(caller.runs.cancel).toHaveBeenCalledWith({ runId: 'r1' });
    await app.close();
  });

  it('redirects an artifact to a short-lived presigned GET after the ACL check (§6.9)', async () => {
    presignGet.mockReturnValue('https://s3.local/signed');
    const app = await build();

    const res = await app.inject({ url: '/v1/runs/r1/artifacts/result.json', headers: auth });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://s3.local/signed');
    expect(presignGet).toHaveBeenCalledWith('runs/r1/result.json', PRESIGN_TTL_SECONDS, {
      attachment: true,
      filename: 'result.json',
    });
    await app.close();
  });

  it('404s an artifact that is not part of the run, and never signs it', async () => {
    caller.runs.get.mockResolvedValue({});
    const app = await build();

    const res = await app.inject({ url: '/v1/runs/r1/artifacts/other.json', headers: auth });

    expect(res.statusCode).toBe(404);
    expect(presignGet).not.toHaveBeenCalled();
    await app.close();
  });

  it('applies a proposal, defaulting selection and conflict resolutions', async () => {
    caller.proposals.applySelected.mockResolvedValue({ applied: 0 });
    const app = await build();

    await app.inject({
      method: 'POST',
      url: '/v1/proposals/p1/apply',
      headers: auth,
      payload: {},
    });
    expect(caller.proposals.applySelected).toHaveBeenCalledWith({
      proposalId: 'p1',
      selectedItemIds: [],
      conflictResolutions: {},
    });

    await app.inject({
      method: 'POST',
      url: '/v1/proposals/p1/apply',
      headers: auth,
      payload: { selectedItemIds: ['i1'], conflictResolutions: { i1: 'replace' } },
    });
    expect(caller.proposals.applySelected).toHaveBeenLastCalledWith({
      proposalId: 'p1',
      selectedItemIds: ['i1'],
      conflictResolutions: { i1: 'replace' },
    });
    await app.close();
  });
});
