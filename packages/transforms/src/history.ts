/** Run history, replay and run comparison (21_TRANSFORM_SYSTEM.md §9.1, §10). Pure, no I/O. */

import type { ModeContext } from './modes.ts';
import type { TransformRegistry } from './registry.ts';
import { routeTransform } from './router.ts';
import type {
  EngineId,
  EntityKind,
  ExclusionReason,
  ExecutionMode,
  ProviderId,
  TransformId,
} from './types.ts';

/** §9.1 lifecycle. */
export const RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunInput {
  readonly kind: EntityKind;
  readonly value: string;
}

/** One produced entity, identified by kind + value (identity keys stay in 10_INTEGRATIONS §8.2). */
export interface RunEntity {
  readonly kind: EntityKind;
  readonly value: string;
  readonly confidence: number;
  /** Raw artifact pointers backing the entity (§9.4). */
  readonly evidence: readonly string[];
}

/** What §10 requires a run to store. */
export interface RunRecord {
  readonly id: string;
  readonly transform: TransformId;
  readonly transformVersion: string;
  readonly input: RunInput;
  readonly engine: EngineId;
  readonly engineVersion: string;
  readonly provider: ProviderId;
  readonly mode: ExecutionMode;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly status: RunStatus;
  readonly results: readonly RunEntity[];
  readonly errors: readonly string[];
  /** Set when this run is a replay of an earlier one; the original is kept untouched. */
  readonly replayOf?: string;
}

export const runDurationMs = (run: RunRecord): number => run.finishedAt - run.startedAt;
export const runResultCount = (run: RunRecord): number => run.results.length;

export interface RunHistory {
  record(run: RunRecord): void;
  get(id: string): RunRecord | undefined;
  /** Newest first. */
  all(): readonly RunRecord[];
  forTransform(id: TransformId): readonly RunRecord[];
  forInput(input: RunInput): readonly RunRecord[];
}

/** In-memory history; persistence is the repository's job (ADR-001), not this package's. */
export const createRunHistory = (initial: readonly RunRecord[] = []): RunHistory => {
  const runs = new Map<string, RunRecord>(initial.map((run) => [run.id, run]));
  const newestFirst = (): readonly RunRecord[] =>
    [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);

  return {
    record: (run) => void runs.set(run.id, run),
    get: (id) => runs.get(id),
    all: newestFirst,
    forTransform: (id) => newestFirst().filter((run) => run.transform === id),
    forInput: (input) =>
      newestFirst().filter(
        (run) => run.input.kind === input.kind && run.input.value === input.value,
      ),
  };
};

export interface ReplayRequest {
  readonly transform: TransformId;
  readonly input: RunInput;
  /** Today's engine chain, best first — not the engine the original run used. */
  readonly chain: readonly EngineId[];
  readonly replayOf: string;
  /** Set when the original engine is no longer the routed first choice. */
  readonly engineChanged: boolean;
}

export interface ReplayRefusal {
  readonly replayOf: string;
  readonly reason: ExclusionReason;
}

/**
 * Re-run with today's engines and today's provider status (§10). The original run is never
 * modified; the caller executes the request and records a new run with `replayOf` set.
 */
export const planReplay = (
  registry: TransformRegistry,
  run: RunRecord,
  ctx: ModeContext,
): ReplayRequest | ReplayRefusal => {
  const manifest = registry.transform(run.transform);
  if (!manifest) return { replayOf: run.id, reason: 'not-executable' };

  const routed = routeTransform(registry, manifest, ctx);
  const chain = routed.chain.map((candidate) => candidate.engine.id);
  if (routed.reason !== undefined) return { replayOf: run.id, reason: routed.reason };

  return {
    transform: run.transform,
    input: run.input,
    chain,
    replayOf: run.id,
    engineChanged: chain[0] !== run.engine,
  };
};

export const isReplayRefusal = (result: ReplayRequest | ReplayRefusal): result is ReplayRefusal =>
  'reason' in result;

export interface RunEntityChange {
  readonly before: RunEntity;
  readonly after: RunEntity;
  /** Evidence pointers present in the newer run only. */
  readonly newEvidence: readonly string[];
}

export interface RunComparison {
  readonly added: readonly RunEntity[];
  readonly removed: readonly RunEntity[];
  readonly changed: readonly RunEntityChange[];
  readonly unchanged: readonly RunEntity[];
}

const entityKey = (entity: RunEntity): string => `${entity.kind}:${entity.value}`;

/**
 * Diff two runs of the same transform into added / removed / changed / new evidence (§10).
 * `before` is the older run, `after` the newer one.
 */
export const compareRuns = (before: RunRecord, after: RunRecord): RunComparison => {
  const beforeByKey = new Map(before.results.map((entity) => [entityKey(entity), entity]));
  const added: RunEntity[] = [];
  const changed: RunEntityChange[] = [];
  const unchanged: RunEntity[] = [];

  for (const entity of after.results) {
    const previous = beforeByKey.get(entityKey(entity));
    if (!previous) {
      added.push(entity);
      continue;
    }
    beforeByKey.delete(entityKey(entity));
    const newEvidence = entity.evidence.filter((item) => !previous.evidence.includes(item));
    if (newEvidence.length > 0 || previous.confidence !== entity.confidence) {
      changed.push({ before: previous, after: entity, newEvidence });
    } else {
      unchanged.push(entity);
    }
  }

  return { added, removed: [...beforeByKey.values()], changed, unchanged };
};
