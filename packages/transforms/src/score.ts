/** Engine and transform scores (21_TRANSFORM_SYSTEM.md §6). Pure, explainable, testable. */

import type {
  DataFlow,
  EngineManifest,
  ExecutionClass,
  ProviderStatus,
  TransformManifest,
  TransformPriority,
} from './types.ts';

const PRIVACY: Record<DataFlow, number> = {
  local: 1,
  network: 0.6,
  'external-api': 0.3,
};

const AVAILABILITY: Record<ProviderStatus, number> = {
  configured: 1,
  'not-configured': 0.5,
  invalid: 0.1,
  'rate-limited': 0.2,
  disabled: 0,
  unavailable: 0,
  deprecated: 0,
};

const SPEED: Record<ExecutionClass, number> = {
  fast: 1,
  standard: 0.7,
  deep: 0.3,
  optional: 0.5,
};

const PRIORITY_WEIGHT: Record<TransformPriority, number> = {
  core: 1,
  recommended: 0.9,
  optional: 0.7,
  experimental: 0.5,
  external: 0.3,
  deprecated: 0,
};

export interface ScoreBreakdown {
  readonly resultQuality: number;
  readonly reliability: number;
  readonly privacy: number;
  readonly availability: number;
  readonly speed: number;
  readonly maintenance: number;
  readonly total: number;
}

/** Weighted sum; weights sum to 1 so the total is directly comparable across engines. */
export const scoreEngine = (
  engine: EngineManifest,
  providerStatus: ProviderStatus,
): ScoreBreakdown => {
  const parts = {
    resultQuality: 0.3 * engine.quality.resultQuality,
    reliability: 0.2 * engine.quality.reliability,
    privacy: 0.15 * PRIVACY[engine.dataFlow],
    availability: 0.15 * AVAILABILITY[providerStatus],
    speed: 0.1 * SPEED[engine.cost],
    maintenance: 0.1 * engine.quality.maintenance,
  };
  const total = Object.values(parts).reduce((sum, value) => sum + value, 0);
  return { ...parts, total };
};

/**
 * Ranking value for the contextual menu and the library: the best usable engine, weighted by how
 * important the transform is. Zero when nothing is usable — the transform is still listed, with a
 * reason (§7); the score only decides order.
 */
export const scoreTransform = (transform: TransformManifest, bestEngineScore: number): number =>
  bestEngineScore * PRIORITY_WEIGHT[transform.priority];
