/**
 * `runs.*` and `proposals.*` — the run lifecycle surface (10_INTEGRATIONS.md §7, §10, §12).
 *
 * The API never executes anything (N5, R4): it validates, gates, rate-limits, writes the run row
 * and enqueues. Everything after that belongs to `apps/runner` and `apps/worker`. The order of the
 * checks in `start` is the legal gate's order and is not an accident: consent before quota before
 * dedupe, so a user is never told "slow down" about a run they were never allowed to make.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@nexus/db';
import { newId } from '@nexus/domain';
import {
  assertConsentValid,
  assertTargetsAllowed,
  builtinRegistry,
  inputHash,
  isIntegrationError,
  redactInput,
  type ImportProposal,
  type ResolvedTarget,
} from '@nexus/integrations';

import { audit } from '../../audit.ts';
import { enqueueRun, publishRunEvent, requestRunCancel } from '../../integrations/queue.ts';
import { applyProposalRemotely } from '../../integrations/applyProposal.ts';
import { orgProcedure, router } from '../trpc.ts';

const Id = z.string().min(1).max(64);

/** Maps an `IntegrationError` onto the tRPC code the client already knows how to render. */
function toTRPC(error: unknown): never {
  if (isIntegrationError(error)) {
    const status =
      error.code === 'CONSENT_REQUIRED' ||
      error.code === 'CONSENT_EXPIRED' ||
      error.code === 'TARGET_NOT_ALLOWED'
        ? 'FORBIDDEN'
        : error.code === 'RATE_LIMITED' ||
            error.code === 'QUOTA_EXCEEDED' ||
            error.code === 'CONCURRENCY_LIMIT'
          ? 'TOO_MANY_REQUESTS'
          : 'BAD_REQUEST';
    throw new TRPCError({
      code: status,
      message: `${error.code}: ${error.payload.what} ${error.payload.why}`,
    });
  }
  throw error;
}

async function loadRun(runId: string, orgId: string) {
  const run = await prisma.integrationRun.findFirst({ where: { id: runId, orgId } });
  if (run === null) {
    // A run in another org is "not found", never "forbidden": the second answer leaks existence.
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That run no longer exists.' });
  }
  return run;
}

export const runsRouter = router({
  /** §7.2 step 1–3: everything that must be true before a tool is allowed to contact anyone. */
  start: orgProcedure('editor')
    .input(
      z.object({
        integrationId: Id,
        projectId: Id,
        boardId: Id,
        anchorNodeId: Id.optional(),
        input: z.record(z.unknown()),
        targets: z
          .array(
            z.object({
              kind: z.string().max(24),
              value: z.string().max(2000),
              scope: z.enum(['public-index', 'owned-asset', 'third-party-host']),
            }),
          )
          .max(200),
        consentToken: z.string().min(1),
        /** Set by the user after a `RATE_LIMITED` refusal, and audited. */
        force: z.boolean().default(false),
        parentRunId: Id.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entry = builtinRegistry().entries.get(input.integrationId);
      if (entry === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That tool is not installed.' });
      }
      const manifest = entry.manifest;
      const now = new Date();
      const targets = input.targets as ResolvedTarget[];

      const consent = await prisma.consent.findFirst({
        where: { id: input.consentToken, orgId: ctx.org.id, projectId: input.projectId },
      });

      try {
        assertConsentValid({
          manifest,
          consent:
            consent === null
              ? null
              : {
                  ...consent,
                  acceptedAt: consent.acceptedAt.toISOString(),
                  expiresAt: consent.expiresAt.toISOString(),
                  revokedAt: consent.revokedAt?.toISOString() ?? null,
                  usedAt: consent.usedAt?.toISOString() ?? null,
                  scope: consent.scope as ResolvedTarget['scope'],
                },
          targets,
          projectId: input.projectId,
          userId: ctx.user.id,
          now: now.toISOString(),
        });
        assertTargetsAllowed(manifest, targets, {
          // Default org policy: owned assets and public indexes; scanning third-party hosts stays
          // off until an admin enables it per project (§12.2).
          allowedScopes: ['owned-asset', 'public-index'],
        });
      } catch (error) {
        toTRPC(error);
      }

      const hash = inputHash(manifest.id, input.input);

      // §12.3 quotas, all four buckets, checked before anything is enqueued.
      const hourAgo = new Date(now.getTime() - 60 * 60_000);
      const [userRuns, orgRuns, activeRuns, recent] = await Promise.all([
        prisma.integrationRun.count({
          where: {
            orgId: ctx.org.id,
            actorUserId: ctx.user.id,
            integrationId: manifest.id,
            createdAt: { gte: hourAgo },
          },
        }),
        prisma.integrationRun.count({
          where: { orgId: ctx.org.id, integrationId: manifest.id, createdAt: { gte: hourAgo } },
        }),
        prisma.integrationRun.count({
          where: {
            orgId: ctx.org.id,
            status: { in: ['queued', 'starting', 'running', 'parsing'] },
          },
        }),
        prisma.integrationRun.findFirst({
          where: { integrationId: manifest.id, inputHash: hash, orgId: ctx.org.id },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      if (userRuns >= manifest.rateLimits.perUserPerHour) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `QUOTA_EXCEEDED: Hourly limit reached. You've used ${String(userRuns)} of ${String(manifest.rateLimits.perUserPerHour)} runs this hour.`,
        });
      }
      if (orgRuns >= manifest.rateLimits.perOrgPerHour) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'QUOTA_EXCEEDED: Your organization used its hourly budget for this tool.',
        });
      }
      if (activeRuns >= manifest.rateLimits.concurrentRunsPerOrg) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `CONCURRENCY_LIMIT: Too many runs at once. Your organization allows ${String(manifest.rateLimits.concurrentRunsPerOrg)} concurrent runs.`,
        });
      }

      // §8 edge case: an identical run inside the dedupe window returns the first run's id with a
      // notice instead of hitting the third party twice.
      if (
        !input.force &&
        recent !== null &&
        now.getTime() - recent.createdAt.getTime() < manifest.rateLimits.minIntervalMsSameInput
      ) {
        return {
          runId: recent.id,
          reused: true,
          notice:
            'Using a recent identical run. Change an input or force a re-run to start a new one.',
        };
      }

      const run = await prisma.integrationRun.create({
        data: {
          id: newId.run(),
          orgId: ctx.org.id,
          projectId: input.projectId,
          boardId: input.boardId,
          integrationId: manifest.id,
          adapterVersion: manifest.version,
          toolVersion: manifest.toolVersion,
          imageDigest: manifest.execution.kind === 'container' ? manifest.execution.digest : null,
          actorUserId: ctx.user.id,
          anchorNodeId: input.anchorNodeId ?? null,
          input: redactInput(manifest, input.input) as unknown as Record<string, never>,
          inputHash: hash,
          targets: targets as unknown as Record<string, never>[],
          consentId: consent?.id ?? null,
          status: 'queued',
          parentRunId: input.parentRunId ?? null,
        },
      });

      if (consent !== null && manifest.risk.label === 'high') {
        await prisma.consent.update({ where: { id: consent.id }, data: { usedAt: now } });
      }

      await enqueueRun({ runId: run.id, orgId: ctx.org.id, attempt: 1 });
      await audit(
        {
          action: 'integration.run.requested',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'run',
          targetId: run.id,
          ip: ctx.ip,
          metadata: {
            integrationId: manifest.id,
            inputHash: hash,
            targets: targets.length,
            forced: input.force,
          },
        },
        ctx.logger,
      );

      return { runId: run.id, reused: false, notice: null };
    }),

  get: orgProcedure('viewer')
    .input(z.object({ runId: Id }))
    .query(async ({ ctx, input }) => {
      const run = await loadRun(input.runId, ctx.org.id);
      return {
        id: run.id,
        integrationId: run.integrationId,
        boardId: run.boardId,
        status: run.status,
        stats: run.stats,
        artifacts: run.artifacts,
        errorCode: run.errorCode,
        errorDetail: run.errorDetail,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
        proposalId: run.proposalId,
        parentRunId: run.parentRunId,
        createdAt: run.createdAt,
      };
    }),

  /** §7.7 history: reverse-chronological, filterable, cursor-paginated. */
  list: orgProcedure('viewer')
    .input(
      z
        .object({
          boardId: Id.optional(),
          projectId: Id.optional(),
          integrationId: Id.optional(),
          status: z.string().max(24).optional(),
          cursor: Id.optional(),
          limit: z.number().int().min(1).max(100).default(25),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const runs = await prisma.integrationRun.findMany({
        where: {
          orgId: ctx.org.id,
          ...(input.boardId === undefined ? {} : { boardId: input.boardId }),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          ...(input.integrationId === undefined ? {} : { integrationId: input.integrationId }),
          ...(input.status === undefined ? {} : { status: input.status as 'queued' }),
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit + 1,
        ...(input.cursor === undefined ? {} : { cursor: { id: input.cursor }, skip: 1 }),
      });
      const page = runs.slice(0, input.limit);
      return {
        runs: page.map((run) => ({
          id: run.id,
          integrationId: run.integrationId,
          boardId: run.boardId,
          actorUserId: run.actorUserId,
          status: run.status,
          durationMs: run.durationMs,
          proposalId: run.proposalId,
          createdAt: run.createdAt,
        })),
        nextCursor: runs.length > input.limit ? page.at(-1)?.id : undefined,
      };
    }),

  log: orgProcedure('viewer')
    .input(z.object({ runId: Id, afterSeq: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      await loadRun(input.runId, ctx.org.id);
      const entries = await prisma.runLogEntry.findMany({
        where: { runId: input.runId, seq: { gte: input.afterSeq } },
        orderBy: { seq: 'asc' },
        take: 2000,
      });
      return entries.map((entry) => ({
        seq: entry.seq,
        at: entry.at,
        level: entry.level,
        phase: entry.phase,
        message: entry.message,
        data: entry.data,
      }));
    }),

  /** Cancellation is authoritative through Redis, so it works even if the UI lost its socket. */
  cancel: orgProcedure('editor')
    .input(z.object({ runId: Id }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(input.runId, ctx.org.id);
      if (['succeeded', 'failed', 'cancelled', 'timed_out', 'partial'].includes(run.status)) {
        return { status: run.status, cancelled: false };
      }
      await requestRunCancel(run.id, 15 * 60_000);
      await prisma.integrationRun.updateMany({
        where: { id: run.id, status: { in: ['queued', 'awaiting_approval'] } },
        data: { status: 'cancelled', errorCode: 'CANCELLED', finishedAt: new Date() },
      });
      await audit(
        {
          action: 'integration.run.cancelled',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'run',
          targetId: run.id,
          ip: ctx.ip,
        },
        ctx.logger,
      );
      publishRunEvent(run.id, { t: 'status', status: 'cancelled', at: new Date().toISOString() });
      return { status: 'cancelled', cancelled: true };
    }),

  /** §7.6 diff-with-previous, computed on identity-key sets; deletion is never proposed. */
  diff: orgProcedure('viewer')
    .input(z.object({ runId: Id, previousRunId: Id.optional() }))
    .query(async ({ ctx, input }) => {
      const run = await loadRun(input.runId, ctx.org.id);
      const previous =
        input.previousRunId === undefined
          ? await prisma.integrationRun.findFirst({
              where: {
                orgId: ctx.org.id,
                integrationId: run.integrationId,
                inputHash: run.inputHash,
                createdAt: { lt: run.createdAt },
                status: { in: ['succeeded', 'partial'] },
              },
              orderBy: { createdAt: 'desc' },
            })
          : await loadRun(input.previousRunId, ctx.org.id);
      if (previous === null) return { added: [], removed: [], changed: [], previousRunId: null };

      const [current, before] = await Promise.all([
        loadProposal(run.proposalId),
        loadProposal(previous.proposalId),
      ]);
      const keysOf = (proposal: ImportProposal | null): Map<string, string> =>
        new Map(
          (proposal?.items ?? [])
            .filter((item) => item.kind === 'new_node')
            .map((item) => [item.node.identityKey, JSON.stringify(item.node.props)]),
        );
      const now = keysOf(current);
      const past = keysOf(before);

      return {
        previousRunId: previous.id,
        added: [...now.keys()].filter((key) => !past.has(key)),
        // "no longer observed" — absence of evidence is not evidence of absence (§7.6).
        removed: [...past.keys()].filter((key) => !now.has(key)),
        changed: [...now.keys()].filter((key) => past.has(key) && past.get(key) !== now.get(key)),
      };
    }),
});

async function loadProposal(proposalId: string | null): Promise<ImportProposal | null> {
  if (proposalId === null) return null;
  const row = await prisma.importProposal.findUnique({ where: { id: proposalId } });
  return row === null ? null : (row.payload as unknown as ImportProposal);
}

export const proposalsRouter = router({
  get: orgProcedure('viewer')
    .input(z.object({ proposalId: Id }))
    .query(async ({ ctx, input }) => {
      const row = await prisma.importProposal.findFirst({
        where: { id: input.proposalId, orgId: ctx.org.id },
      });
      if (row === null) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That result set no longer exists.' });
      }
      if (row.expiresAt.getTime() <= Date.now()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'PROPOSAL_EXPIRED: This result set expired. Proposals are kept for 7 days. Re-run the tool.',
        });
      }
      return { ...(row.payload as unknown as ImportProposal), appliedItems: row.appliedItems };
    }),

  /**
   * Headless apply. The browser applies client-side against its own Y.Doc; a token client has no
   * doc, so the same Applier runs in `apps/sync` against the room's document (§10) — never a
   * second write path.
   */
  applySelected: orgProcedure('editor')
    .input(
      z.object({
        proposalId: Id,
        selectedItemIds: z.array(z.string().max(120)).max(5000),
        conflictResolutions: z.record(z.enum(['keep', 'replace', 'keep_both'])).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await prisma.importProposal.findFirst({
        where: { id: input.proposalId, orgId: ctx.org.id },
      });
      if (row === null) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That result set no longer exists.' });
      }
      const proposal = row.payload as unknown as ImportProposal;
      const result = await applyProposalRemotely({
        boardId: row.boardId,
        proposal,
        selectedItemIds: input.selectedItemIds,
        conflictResolutions: input.conflictResolutions,
        alreadyApplied: (row.appliedItems ?? {}) as Record<string, string>,
        now: new Date().toISOString(),
      });

      await prisma.importProposal.update({
        where: { id: row.id },
        data: {
          appliedAt: new Date(),
          appliedBy: ctx.user.id,
          appliedItems: {
            ...((row.appliedItems ?? {}) as Record<string, string>),
            ...result.tempIdMap,
          },
        },
      });
      await prisma.integrationRun.updateMany({
        where: { proposalId: row.id },
        data: { appliedAt: new Date() },
      });
      await audit(
        {
          action: 'integration.proposal.applied',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'proposal',
          targetId: row.id,
          ip: ctx.ip,
          metadata: {
            createdNodeIds: result.createdNodeIds.length,
            createdEdgeIds: result.createdEdgeIds.length,
            skipped: result.skipped.length,
          },
        },
        ctx.logger,
      );
      return result;
    }),

  discard: orgProcedure('editor')
    .input(z.object({ proposalId: Id }))
    .mutation(async ({ ctx, input }) => {
      const row = await prisma.importProposal.findFirst({
        where: { id: input.proposalId, orgId: ctx.org.id },
      });
      if (row === null) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That result set no longer exists.' });
      }
      await prisma.importProposal.update({
        where: { id: row.id },
        data: { discardedAt: new Date() },
      });
      await audit(
        {
          action: 'integration.proposal.discarded',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'proposal',
          targetId: row.id,
          ip: ctx.ip,
        },
        ctx.logger,
      );
      return { discarded: true };
    }),
});
