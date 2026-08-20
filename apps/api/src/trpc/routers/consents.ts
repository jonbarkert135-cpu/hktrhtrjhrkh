/**
 * `consents.*` — the legal gate's recording surface (10_INTEGRATIONS.md §12.1).
 *
 * A consent row is evidence: it stores *which wording* was shown (hashed), *which targets* it
 * covered (hashed), when, from where. Nothing here decides whether a run may start — that is
 * `assertConsentValid` in `packages/integrations`, called by `runs.start` — so the recording and
 * the enforcement cannot drift apart.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@nexus/db';
import { newId } from '@nexus/domain';
import {
  builtinRegistry,
  consentTtlMs,
  hashText,
  targetsHash,
  TARGET_SCOPES,
  type ResolvedTarget,
} from '@nexus/integrations';

import { audit } from '../../audit.ts';
import { orgProcedure, router } from '../trpc.ts';

const zTarget = z.object({
  kind: z.string().max(24),
  value: z.string().max(2000),
  scope: z.enum(TARGET_SCOPES),
});

export const consentsRouter = router({
  /**
   * Records an acceptance and returns the token `runs.start` (and `POST /v1/runs`) requires, so a
   * headless client cannot bypass §12 by calling the run endpoint directly.
   */
  accept: orgProcedure('editor')
    .input(
      z.object({
        projectId: z.string().min(1),
        integrationId: z.string().min(1).max(64),
        scope: z.enum(TARGET_SCOPES),
        targets: z.array(zTarget).max(200),
        /** The exact text the user was shown; hashed so we can prove it later. */
        scopeText: z.string().min(20).max(600),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entry = builtinRegistry().entries.get(input.integrationId);
      if (entry === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That tool is not installed.' });
      }
      if (hashText(input.scopeText) !== hashText(entry.manifest.consent.scopeText)) {
        // The client showed wording that is not the manifest's: refuse rather than record a
        // consent to text nobody can reproduce.
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The authorization wording changed. Reopen the dialog and confirm again.',
        });
      }

      const now = new Date();
      const ttl = consentTtlMs(entry.manifest.risk.label);
      const consent = await prisma.consent.create({
        data: {
          id: newId.consent(),
          orgId: ctx.org.id,
          projectId: input.projectId,
          userId: ctx.user.id,
          integrationId: input.integrationId,
          scope: input.scope,
          targetsHash: targetsHash(input.targets as ResolvedTarget[]),
          scopeTextHash: hashText(entry.manifest.consent.scopeText),
          acceptedAt: now,
          // A high-risk consent covers one run; the row still expires so nothing lives forever.
          expiresAt: new Date(now.getTime() + (ttl === 0 ? 15 * 60_000 : ttl)),
          ip: ctx.ip,
        },
      });

      await audit(
        {
          action: 'integration.consent.accepted',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'consent',
          targetId: consent.id,
          ip: ctx.ip,
          metadata: { integrationId: input.integrationId, scopeTextHash: consent.scopeTextHash },
        },
        ctx.logger,
      );

      return { consentToken: consent.id, expiresAt: consent.expiresAt };
    }),

  /** Settings → Privacy. Revocation cancels queued runs that rely on the consent (§12.1). */
  list: orgProcedure('viewer')
    .input(z.object({ projectId: z.string().min(1).optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const consents = await prisma.consent.findMany({
        where: {
          orgId: ctx.org.id,
          userId: ctx.user.id,
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        },
        orderBy: { acceptedAt: 'desc' },
        take: 100,
      });
      return consents.map((consent) => ({
        id: consent.id,
        integrationId: consent.integrationId,
        scope: consent.scope,
        acceptedAt: consent.acceptedAt,
        expiresAt: consent.expiresAt,
        revokedAt: consent.revokedAt,
      }));
    }),

  revoke: orgProcedure('editor')
    .input(z.object({ consentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const consent = await prisma.consent.findFirst({
        where: { id: input.consentId, orgId: ctx.org.id, userId: ctx.user.id },
      });
      if (consent === null) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That authorization no longer exists.' });
      }
      const now = new Date();
      await prisma.consent.update({ where: { id: consent.id }, data: { revokedAt: now } });
      // Queued runs leaning on it stop before they contact anyone.
      await prisma.integrationRun.updateMany({
        where: { consentId: consent.id, status: { in: ['queued', 'awaiting_approval'] } },
        data: { status: 'cancelled', errorCode: 'CONSENT_EXPIRED', finishedAt: now },
      });
      await audit(
        {
          action: 'integration.consent.revoked',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'consent',
          targetId: consent.id,
          ip: ctx.ip,
        },
        ctx.logger,
      );
      return { revokedAt: now };
    }),
});
