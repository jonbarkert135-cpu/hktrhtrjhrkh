/**
 * `apps/worker` — the first BullMQ consumer this codebase ships (10_INTEGRATIONS.md §2).
 *
 * It runs the CPU-heavy half of the pipeline (stages 3–7) outside the runner's container slot. It
 * depends on `packages/db`, `packages/domain` and `packages/integrations`, and deliberately not on
 * `apps/runner`: the only contract between the two services is the queue payload and the artifact
 * store.
 */

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '@nexus/db';
import { loadServerEnvFromProcess } from '@nexus/config/env-file';
import { createLogger } from '@nexus/config/log';
import { newId } from '@nexus/domain';
import { IDENTITY_KEY_PROP, type ArtifactRef, type ExistingNodeMatch } from '@nexus/integrations';

import {
  processParseJob,
  type ArtifactReader,
  type ParseStore,
  type RunRow,
} from './queues/integration.parse.ts';

const log = createLogger({
  service: 'raven-worker',
  env: process.env.NEXUS_ENV ?? 'local',
  version: process.env.NEXUS_VERSION ?? '0.1.0',
});

export const PARSE_QUEUE = 'integration.parse';

/** Reads an artifact back out of S3 as a stream; the parser never buffers a whole 40 MB document. */
export function s3ArtifactReader(env: ReturnType<typeof loadServerEnvFromProcess>): ArtifactReader {
  return {
    async read(ref: ArtifactRef) {
      const url = `${env.S3_ENDPOINT.replace(/\/$/, '')}/${ref.bucket}/${ref.key}`;
      const response = await fetch(url);
      if (!response.ok || response.body === null) {
        throw new Error(`artifact ${ref.key} could not be read (${String(response.status)})`);
      }
      const reader = response.body.getReader();
      return (async function* stream() {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value !== undefined) yield value;
        }
      })();
    },
  };
}

export const prismaParseStore: ParseStore = {
  async loadRun(runId) {
    const row = await prisma.integrationRun.findUnique({ where: { id: runId } });
    if (row === null) return null;
    return {
      id: row.id,
      orgId: row.orgId,
      projectId: row.projectId,
      boardId: row.boardId,
      integrationId: row.integrationId,
      actorUserId: row.actorUserId,
      anchorNodeId: row.anchorNodeId,
      input: (row.input ?? {}) as Record<string, unknown>,
      artifacts: (row.artifacts ?? []) as unknown as ArtifactRef[],
      status: row.status,
      exitCode: row.exitCode,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: row.durationMs,
      stats: (row.stats ?? {}) as unknown as RunRow['stats'],
    };
  },

  async findCandidates(boardId, identityKeys) {
    if (identityKeys.length === 0) return [];
    // The projection (P8) is the queryable mirror of the board; identity keys live in `data`.
    const rows = await prisma.boardProjectionNode.findMany({
      where: { boardId, deletedAt: null },
      select: { id: true, title: true, type: true, data: true },
      take: 5000,
    });
    const wanted = new Set(identityKeys);
    const matches: ExistingNodeMatch[] = [];
    for (const row of rows) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      const key = data[IDENTITY_KEY_PROP];
      if (typeof key !== 'string' || !wanted.has(key)) continue;
      matches.push({
        nodeId: row.id,
        kind: 'unknown',
        identityKey: key,
        title: row.title,
        props: data,
        boardId,
      });
    }
    return matches;
  },

  async saveProposal(proposal, run) {
    await prisma.importProposal.create({
      data: {
        id: proposal.id,
        orgId: run.orgId,
        projectId: run.projectId,
        boardId: run.boardId,
        runId: run.id,
        integrationId: proposal.integrationId,
        payload: proposal as unknown as object,
        summary: proposal.summary as unknown as object,
        expiresAt: new Date(proposal.expiresAt),
      },
    });
  },

  async markSucceeded(runId, proposalId, itemsFound) {
    const run = await prisma.integrationRun.findUnique({
      where: { id: runId },
      select: { status: true, stats: true },
    });
    await prisma.integrationRun.update({
      where: { id: runId },
      data: {
        // A run that produced partial output stays `partial`: the proposal is real but incomplete.
        status: run?.status === 'partial' ? 'partial' : 'succeeded',
        proposalId,
        stats: { ...((run?.stats ?? {}) as Record<string, unknown>), itemsFound },
      },
    });
  },

  async markFailed(runId, payload) {
    await prisma.integrationRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorCode: payload.code,
        errorDetail: payload as unknown as object,
      },
    });
  },

  async appendLog(runId, entries) {
    if (entries.length === 0) return;
    const last = await prisma.runLogEntry.findFirst({
      where: { runId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    let seq = (last?.seq ?? -1) + 1;
    await prisma.runLogEntry.createMany({
      data: entries.map((entry) => ({
        runId,
        seq: seq++,
        at: new Date(),
        level: entry.level,
        phase: entry.phase,
        message: entry.message.slice(0, 2000),
      })),
      skipDuplicates: true,
    });
  },
};

export async function start(): Promise<() => Promise<void>> {
  const env = loadServerEnvFromProcess();
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const publisher = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const worker = new Worker(
    PARSE_QUEUE,
    async (job: Job) => {
      const runId = (job.data as { runId?: string }).runId ?? '';
      const outcome = await processParseJob(
        {
          store: prismaParseStore,
          artifacts: s3ArtifactReader(env),
          newProposalId: () => newId.proposal(),
          publish: (id, event) => {
            void publisher.publish(`run:${id}`, JSON.stringify(event));
          },
        },
        runId,
      );
      log.info(
        { event: 'parse.finished', run_id: runId, status: outcome.status },
        'parse job finished',
      );
    },
    { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) },
  );

  log.info({ event: 'worker.started' }, 'worker is consuming integration.parse');

  return async () => {
    await worker.close();
    connection.disconnect();
    publisher.disconnect();
  };
}

if (process.argv[1]?.endsWith('main.ts') === true) {
  void start();
}
