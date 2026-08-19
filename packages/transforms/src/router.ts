/** Capability router: transform + context → ordered engine chain (21_TRANSFORM_SYSTEM.md §5). */

import { engineExclusion, type ModeContext } from './modes.ts';
import type { TransformRegistry } from './registry.ts';
import { scoreEngine, scoreTransform } from './score.ts';
import type { EngineAvailability, ExclusionReason, TransformManifest } from './types.ts';

export interface RoutedTransform {
  readonly transform: TransformManifest;
  /** Usable engines, best first, then the terminal fallback. Empty when nothing can run. */
  readonly chain: readonly EngineAvailability[];
  /** Engines that were considered and refused, with the reason to show the analyst. */
  readonly rejected: readonly EngineAvailability[];
  readonly score: number;
  /** Set when `chain` is empty: the single reason the UI should surface. */
  readonly reason?: ExclusionReason;
}

/** The reason to show when nothing is usable: the most actionable one the analyst can fix. */
const ACTIONABILITY: readonly ExclusionReason[] = [
  'requires-configuration',
  'paid-only',
  'blocked-by-mode',
  'provider-rate-limited',
  'provider-unavailable',
  'permission-denied',
  'provider-deprecated',
  'engine-unavailable',
  'not-executable',
];

const bestReason = (rejected: readonly EngineAvailability[]): ExclusionReason => {
  for (const reason of ACTIONABILITY) {
    if (rejected.some((candidate) => candidate.reason === reason)) return reason;
  }
  return 'no-engine';
};

export const routeTransform = (
  registry: TransformRegistry,
  transform: TransformManifest,
  ctx: ModeContext,
): RoutedTransform => {
  const usable: EngineAvailability[] = [];
  const rejected: EngineAvailability[] = [];

  for (const engine of registry.enginesFor(transform)) {
    const provider = registry.provider(engine.provider);
    if (!provider) continue; // validate() reports this; routing must not crash on it
    const reason = engineExclusion(engine, provider, ctx);
    const entry: EngineAvailability = {
      engine,
      provider,
      usable: reason === undefined,
      ...(reason ? { reason } : {}),
      score: scoreEngine(engine, provider.status).total,
    };
    (reason === undefined ? usable : rejected).push(entry);
  }

  // Terminal engines (link out / manual) always sort last: they end the chain, they do not compete.
  const chain = [...usable].sort((a, b) => {
    if (a.engine.terminal !== b.engine.terminal) return a.engine.terminal ? 1 : -1;
    return b.score - a.score;
  });

  const executable = chain.filter((candidate) => !candidate.engine.terminal);
  const score = scoreTransform(transform, executable[0]?.score ?? 0);

  return {
    transform,
    chain,
    rejected,
    score,
    ...(executable.length === 0 ? { reason: bestReason(rejected) } : {}),
  };
};

/** Routes every transform that accepts `kind`, best first. */
export const routeForInput = (
  registry: TransformRegistry,
  kind: Parameters<TransformRegistry['forInput']>[0],
  ctx: ModeContext,
): readonly RoutedTransform[] =>
  registry
    .forInput(kind)
    .map((transform) => routeTransform(registry, transform, ctx))
    .sort((a, b) => b.score - a.score);
