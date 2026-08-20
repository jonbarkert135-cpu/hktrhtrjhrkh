/**
 * `apiTokens.*` — token management for the REST v1 surface (09_BACKEND.md §4.1).
 *
 * The plaintext appears in exactly one response, in `create`, and nowhere else — not in `list`, not
 * in the audit log, not in a log line. A user may only request scopes their own role already has;
 * the intersection is re-checked on every request anyway (`auth/apiToken.ts`), so a demotion takes
 * effect without touching the token.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@nexus/db';
import { newId } from '@nexus/domain';

import { API_SCOPES, ROLE_SCOPES, generateToken, type ApiScope } from '../../auth/apiToken.ts';
import { audit } from '../../audit.ts';
import { orgProcedure, router } from '../trpc.ts';

const MAX_TOKENS_PER_USER = 20;

export const apiTokensRouter = router({
  list: orgProcedure('viewer').query(async ({ ctx }) => {
    const tokens = await prisma.apiToken.findMany({
      where: { orgId: ctx.org.id, userId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
    });
    return tokens.map((token) => ({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      scopes: token.scopes,
      lastUsedAt: token.lastUsedAt,
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt,
      createdAt: token.createdAt,
    }));
  }),

  create: orgProcedure('editor')
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
        expiresAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const allowed = new Set<ApiScope>(ROLE_SCOPES[ctx.role ?? 'viewer']);
      const denied = input.scopes.filter((scope) => !allowed.has(scope));
      if (denied.length > 0) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `A token cannot exceed your own permissions. You cannot grant: ${denied.join(', ')}.`,
        });
      }
      const existing = await prisma.apiToken.count({
        where: { orgId: ctx.org.id, userId: ctx.user.id, revokedAt: null },
      });
      if (existing >= MAX_TOKENS_PER_USER) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `You already have ${String(MAX_TOKENS_PER_USER)} active tokens. Revoke one first.`,
        });
      }

      const generated = generateToken();
      const token = await prisma.apiToken.create({
        data: {
          id: newId.apiToken(),
          orgId: ctx.org.id,
          userId: ctx.user.id,
          name: input.name,
          prefix: generated.prefix,
          hash: generated.hash,
          scopes: input.scopes,
          expiresAt: input.expiresAt ?? null,
        },
      });

      await audit(
        {
          action: 'apiToken.created',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'apiToken',
          targetId: token.id,
          ip: ctx.ip,
          metadata: { scopes: input.scopes, prefix: generated.prefix },
        },
        ctx.logger,
      );

      // The only time the plaintext exists outside the caller's screen.
      return {
        id: token.id,
        name: token.name,
        scopes: token.scopes,
        expiresAt: token.expiresAt,
        token: generated.plaintext,
      };
    }),

  revoke: orgProcedure('editor')
    .input(z.object({ tokenId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const token = await prisma.apiToken.findFirst({
        where: { id: input.tokenId, orgId: ctx.org.id, userId: ctx.user.id },
      });
      if (token === null) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That token no longer exists.' });
      }
      const revokedAt = new Date();
      await prisma.apiToken.update({ where: { id: token.id }, data: { revokedAt } });
      await audit(
        {
          action: 'apiToken.revoked',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'apiToken',
          targetId: token.id,
          ip: ctx.ip,
        },
        ctx.logger,
      );
      return { revokedAt };
    }),
});
