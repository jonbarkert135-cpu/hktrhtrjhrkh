/**
 * REST v1 — the token-authenticated surface for plugins and webhooks (10_INTEGRATIONS.md §10,
 * 15_SECURITY.md §4.1's REST row).
 *
 * It mirrors the tRPC procedures rather than reimplementing them: the caller is resolved from a
 * bearer token to a user plus a scope intersection, and then the same routers run. That is what
 * keeps the authz matrix meaningful — there is no second policy hiding behind the REST prefix.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '@nexus/db';

import {
  hasScope,
  looksLikeApiToken,
  resolveToken,
  type ApiScope,
  type ResolvedToken,
} from '../auth/apiToken.ts';
import { getStorage } from '../files/storage.ts';
import type { Context, OrgRole } from '../trpc/context.ts';
import { appRouter } from '../trpc/router.ts';
import { createCallerFactory } from '../trpc/trpc.ts';

/** 1 MB body cap for every REST route (§7 of the phase spec). */
export const REST_BODY_LIMIT = 1_048_576;
export const PRESIGN_TTL_SECONDS = 300;

const createCaller = createCallerFactory(appRouter);

interface AuthedRequest extends FastifyRequest {
  apiToken?: ResolvedToken;
  orgRole?: OrgRole;
}

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

/** Resolves the token *and* the caller's current role, so a demotion is felt immediately. */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<ResolvedToken | null> {
  const plaintext = bearer(request);
  if (plaintext === undefined || !looksLikeApiToken(plaintext)) {
    await reply
      .code(401)
      .send({ error: 'unauthorized', message: 'A scoped API token is required.' });
    return null;
  }
  const prefix = plaintext.slice(0, 12);
  const stored = await prisma.apiToken.findUnique({ where: { prefix } });
  const membership =
    stored === null
      ? null
      : await prisma.membership.findFirst({
          where: { orgId: stored.orgId, userId: stored.userId },
          select: { role: true },
        });

  const resolution = resolveToken({
    plaintext,
    stored:
      stored === null
        ? null
        : {
            id: stored.id,
            orgId: stored.orgId,
            userId: stored.userId,
            hash: stored.hash,
            scopes: stored.scopes,
            expiresAt: stored.expiresAt,
            revokedAt: stored.revokedAt,
          },
    role: membership?.role ?? null,
    now: new Date(),
  });

  if (!resolution.ok) {
    // 403 for a caller who lost access, 401 for a token that is not usable at all — and never a
    // message that distinguishes "wrong project" from "no such project" (§8 edge cases).
    const status = resolution.reason === 'no_membership' ? 403 : 401;
    await reply.code(status).send({ error: 'unauthorized', message: 'This token cannot be used.' });
    return null;
  }

  await prisma.apiToken.update({
    where: { id: resolution.token.tokenId },
    data: { lastUsedAt: new Date() },
  });
  (request as AuthedRequest).apiToken = resolution.token;
  (request as AuthedRequest).orgRole = membership?.role ?? 'viewer';
  return resolution.token;
}

async function requireScope(
  request: FastifyRequest,
  reply: FastifyReply,
  scope: ApiScope,
): Promise<ResolvedToken | null> {
  const token = (request as AuthedRequest).apiToken ?? (await authenticate(request, reply));
  if (token === null) return null;
  if (!hasScope(token.scopes, scope)) {
    await reply
      .code(403)
      .send({ error: 'forbidden', message: `This token lacks the ${scope} scope.` });
    return null;
  }
  return token;
}

/** Builds the tRPC context a token caller runs under; identical shape to a session caller. */
async function callerFor(request: FastifyRequest, token: ResolvedToken) {
  const [user, org] = await Promise.all([
    prisma.user.findUnique({
      where: { id: token.userId },
      select: { id: true, email: true, name: true },
    }),
    prisma.organization.findUnique({
      where: { id: token.orgId },
      select: { id: true, name: true, slug: true },
    }),
  ]);
  const context: Context = {
    user: user ?? null,
    org: org ?? null,
    role: (request as AuthedRequest).orgRole ?? 'viewer',
    req_id: String(request.id),
    ip: request.ip,
    logger: request.log,
  };
  return createCaller(context);
}

export const restV1Plugin = fp((app: FastifyInstance, _opts, done: () => void) => {
  const route = (path: string): string => `/v1${path}`;

  app.get(route('/integrations'), async (request, reply) => {
    const token = await requireScope(request, reply, 'runs:read');
    if (token === null) return;
    const caller = await callerFor(request, token);
    return reply.send(await caller.integrations.list());
  });

  app.post(route('/consents'), { bodyLimit: REST_BODY_LIMIT }, async (request, reply) => {
    const token = await requireScope(request, reply, 'runs:start');
    if (token === null) return;
    const caller = await callerFor(request, token);
    return reply.send(await caller.consents.accept(request.body as never));
  });

  app.post(route('/runs'), { bodyLimit: REST_BODY_LIMIT }, async (request, reply) => {
    const token = await requireScope(request, reply, 'runs:start');
    if (token === null) return;
    const caller = await callerFor(request, token);
    // §10: `POST /v1/runs` requires a consentToken, so a headless client cannot bypass §12.
    return reply.code(202).send(await caller.runs.start(request.body as never));
  });

  app.get(route('/runs'), async (request, reply) => {
    const token = await requireScope(request, reply, 'runs:read');
    if (token === null) return;
    const caller = await callerFor(request, token);
    return reply.send(await caller.runs.list(request.query as never));
  });

  app.get(route('/runs/:id'), async (request, reply) => {
    const token = await requireScope(request, reply, 'runs:read');
    if (token === null) return;
    const caller = await callerFor(request, token);
    return reply.send(await caller.runs.get({ runId: (request.params as { id: string }).id }));
  });

  app.get(route('/runs/:id/log'), async (request, reply) => {
    const token = await requireScope(request, reply, 'runs:read');
    if (token === null) return;
    const caller = await callerFor(request, token);
    return reply.send(
      await caller.runs.log({ runId: (request.params as { id: string }).id, afterSeq: 0 }),
    );
  });

  /** 302 to a 5-minute presigned GET, after the ACL check — never a public object URL (§6.9). */
  app.get(route('/runs/:id/artifacts/:name'), async (request, reply) => {
    const token = await requireScope(request, reply, 'runs:read');
    if (token === null) return;
    const { id, name } = request.params as { id: string; name: string };
    const caller = await callerFor(request, token);
    const run = await caller.runs.get({ runId: id });
    const artifacts = (run.artifacts ?? []) as { key: string }[];
    const artifact = artifacts.find((candidate) => candidate.key.endsWith(`/${name}`));
    if (artifact === undefined) {
      return reply
        .code(404)
        .send({ error: 'not_found', message: 'That artifact is not part of this run.' });
    }
    const url = getStorage().presignGet(artifact.key, PRESIGN_TTL_SECONDS, {
      attachment: true,
      filename: name,
    });
    return reply.code(302).header('location', url).send();
  });

  app.post(route('/runs/:id/cancel'), async (request, reply) => {
    const token = await requireScope(request, reply, 'runs:start');
    if (token === null) return;
    const caller = await callerFor(request, token);
    return reply.send(await caller.runs.cancel({ runId: (request.params as { id: string }).id }));
  });

  app.get(route('/proposals/:id'), async (request, reply) => {
    const token = await requireScope(request, reply, 'proposals:read');
    if (token === null) return;
    const caller = await callerFor(request, token);
    return reply.send(
      await caller.proposals.get({ proposalId: (request.params as { id: string }).id }),
    );
  });

  app.post(
    route('/proposals/:id/apply'),
    { bodyLimit: REST_BODY_LIMIT },
    async (request, reply) => {
      const token = await requireScope(request, reply, 'proposals:apply');
      if (token === null) return;
      const body = (request.body ?? {}) as {
        selectedItemIds?: string[];
        conflictResolutions?: Record<string, never>;
      };
      const caller = await callerFor(request, token);
      return reply.send(
        await caller.proposals.applySelected({
          proposalId: (request.params as { id: string }).id,
          selectedItemIds: body.selectedItemIds ?? [],
          conflictResolutions: body.conflictResolutions ?? {},
        }),
      );
    },
  );

  done();
});
