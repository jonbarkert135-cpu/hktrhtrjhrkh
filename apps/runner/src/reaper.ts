/**
 * The reaper (10_INTEGRATIONS.md §8 edge cases, phase spec §8).
 *
 * Two failure modes it exists for: the runner dies mid-run (the run row says `running` forever and
 * a container keeps burning CPU), and a run finishes but the worker never picks up the parse (the
 * run sits in `parsing`). Both are swept here, on a timer, with the database as the source of
 * truth — never the process's own memory, which is exactly what a crash destroys.
 */

import { payloadFor } from '@nexus/integrations';

import { TIMERS } from './protocol.ts';

export interface ReapableRun {
  readonly id: string;
  readonly status: string;
  readonly startedAt: Date | null;
  readonly wallClockMs: number;
}

export interface ReaperStore {
  /** Runs this replica believes it owns that are still `starting`/`running`. */
  listActiveRuns(): Promise<readonly ReapableRun[]>;
  listStuckParsing(olderThanMs: number): Promise<readonly ReapableRun[]>;
  failRun(
    runId: string,
    code: 'RUNNER_CRASHED' | 'TIMEOUT' | 'INTERNAL',
    detail: Record<string, unknown>,
  ): Promise<void>;
  flagStaleParsing(runId: string): Promise<void>;
}

export interface ReaperDeps {
  readonly store: ReaperStore;
  /** Run ids of containers still alive on this host. */
  readonly liveContainers: () => Promise<readonly string[]>;
  readonly killContainer: (runId: string) => Promise<void>;
  readonly now?: () => number;
}

export interface ReaperSweep {
  readonly failed: readonly string[];
  readonly killed: readonly string[];
  readonly flagged: readonly string[];
}

/**
 * One sweep. Idempotent: running it twice fails nothing twice, because a run that is already
 * terminal is not returned by `listActiveRuns`.
 */
export async function sweep(deps: ReaperDeps): Promise<ReaperSweep> {
  const now = (deps.now ?? Date.now)();
  const live = new Set(await deps.liveContainers());
  const active = await deps.store.listActiveRuns();
  const failed: string[] = [];
  const killed: string[] = [];

  for (const run of active) {
    const startedAt = run.startedAt?.getTime() ?? now;
    const overdue = now - startedAt > run.wallClockMs + TIMERS.graceMs;
    if (overdue && live.has(run.id)) {
      await deps.killContainer(run.id);
      killed.push(run.id);
      await deps.store.failRun(run.id, 'TIMEOUT', { reapedAt: new Date(now).toISOString() });
      failed.push(run.id);
      continue;
    }
    if (!live.has(run.id) && now - startedAt > TIMERS.containerStartMs) {
      // The row says running, the host has no container: the runner died mid-run. Partial
      // artifacts already uploaded stay retrievable — the row keeps its `artifacts` array.
      await deps.store.failRun(run.id, 'RUNNER_CRASHED', { reapedAt: new Date(now).toISOString() });
      failed.push(run.id);
    }
  }

  // Orphans: a container labelled with a run id that no longer has an active row.
  const activeIds = new Set(active.map((run) => run.id));
  for (const runId of live) {
    if (!activeIds.has(runId)) {
      await deps.killContainer(runId);
      killed.push(runId);
    }
  }

  const stuck = await deps.store.listStuckParsing(TIMERS.staleParsingMs);
  for (const run of stuck) await deps.store.flagStaleParsing(run.id);

  return { failed, killed, flagged: stuck.map((run) => run.id) };
}

/** The user-facing payload a reaped run carries; the run panel shows this, not "unknown error". */
export const crashPayload = (runId: string) => payloadFor('RUNNER_CRASHED', { runId });
