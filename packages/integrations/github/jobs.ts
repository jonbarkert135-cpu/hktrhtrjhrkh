/**
 * GitHub queue job definitions (11_GITHUB.md §10).
 *
 * Pure data + key builders: the table of concurrency/retries/backoff lives here so the worker
 * wiring stays a thin `new Worker(...)` and the same options can be asserted in a unit test
 * without a Redis connection.
 */

import { githubRefKey, type GithubRef } from '@nexus/domain';

/** All GitHub jobs share one BullMQ queue; the job *name* selects the handler. */
export const GITHUB_QUEUE = 'github';

export type GithubJobName =
  | 'github.hydrate'
  | 'github.tab'
  | 'github.analyze'
  | 'github.proposal'
  | 'github.sweep';

export interface GithubHydratePayload {
  nodeId: string;
  ref: GithubRef;
  boardId: string;
  userId: string;
}
export interface GithubTabPayload {
  nodeId: string;
  tab: string;
  force?: boolean;
}
export interface GithubAnalyzePayload {
  repoKey: string;
  headSha: string;
  analyzerVersion: string;
  userId: string;
  boardId: string;
  force?: boolean;
}
export interface GithubProposalPayload {
  analysisId: string;
}
export interface GithubSweepPayload {
  boardId: string;
  /** Hour bucket the sweep belongs to — makes the 30-min cron idempotent per hour (§10). */
  hour: string;
}

export type GithubJobPayload = {
  'github.hydrate': GithubHydratePayload;
  'github.tab': GithubTabPayload;
  'github.analyze': GithubAnalyzePayload;
  'github.proposal': GithubProposalPayload;
  'github.sweep': GithubSweepPayload;
};

export interface GithubJobSpec {
  concurrency: number;
  attempts: number;
  /** Explicit per-attempt delays in ms (§10 gives 2 s / 8 s / 30 s for hydrate). */
  backoffMs: readonly number[];
}

/** §10's table, verbatim. `attempts` counts the first try, so "3 retries" is 4 attempts. */
export const GITHUB_JOB_SPECS: Readonly<Record<GithubJobName, GithubJobSpec>> = {
  'github.hydrate': { concurrency: 8, attempts: 4, backoffMs: [2_000, 8_000, 30_000] },
  'github.tab': { concurrency: 8, attempts: 3, backoffMs: [2_000, 8_000] },
  'github.analyze': { concurrency: 2, attempts: 2, backoffMs: [8_000] },
  'github.proposal': { concurrency: 2, attempts: 2, backoffMs: [8_000] },
  'github.sweep': { concurrency: 1, attempts: 1, backoffMs: [] },
};

/** §10's idempotency keys. Reused as the BullMQ `jobId`, which dedupes enqueues for free. */
export function githubJobId<N extends GithubJobName>(
  name: N,
  payload: GithubJobPayload[N],
): string {
  switch (name) {
    case 'github.hydrate': {
      const p = payload as GithubHydratePayload;
      return `hydrate:${p.nodeId}:${githubRefKey(p.ref)}`;
    }
    case 'github.tab': {
      const p = payload as GithubTabPayload;
      return `tab:${p.nodeId}:${p.tab}`;
    }
    case 'github.analyze': {
      const p = payload as GithubAnalyzePayload;
      return `analyze:${p.repoKey}:${p.headSha}:${p.analyzerVersion}`;
    }
    case 'github.proposal':
      return `proposal:${(payload as GithubProposalPayload).analysisId}`;
    default: {
      const p = payload as GithubSweepPayload;
      return `sweep:${p.boardId}:${p.hour}`;
    }
  }
}

export interface GithubJobOptions {
  jobId: string;
  attempts: number;
  backoff?: { type: 'custom' };
  removeOnComplete: number;
  removeOnFail: number;
}

/**
 * BullMQ options for one enqueue. `force: true` bypasses dedupe by salting the job id — a manual
 * re-run must not be swallowed by the idempotency key of the run it is replacing (§10).
 */
export function githubJobOptions<N extends GithubJobName>(
  name: N,
  payload: GithubJobPayload[N],
  now: number = Date.now(),
): GithubJobOptions {
  const spec = GITHUB_JOB_SPECS[name];
  const base = githubJobId(name, payload);
  const forced = (payload as { force?: boolean }).force === true;
  return {
    jobId: forced ? `${base}:force:${String(now)}` : base,
    attempts: spec.attempts,
    ...(spec.backoffMs.length > 0 ? { backoff: { type: 'custom' as const } } : {}),
    removeOnComplete: 100,
    removeOnFail: 500,
  };
}

/**
 * BullMQ `settings.backoffStrategy`: attempt N (1-based) waits `backoffMs[N-1]`, clamped to the
 * last entry so an operator raising `attempts` never gets an accidental zero-delay retry storm.
 */
export function githubBackoff(name: GithubJobName, attemptsMade: number): number {
  const delays = GITHUB_JOB_SPECS[name].backoffMs;
  if (delays.length === 0) return 0;
  return delays[Math.min(Math.max(attemptsMade, 1), delays.length) - 1] ?? 0;
}
