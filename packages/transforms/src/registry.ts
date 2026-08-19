/** Transform / engine / provider registry with validation (21_TRANSFORM_SYSTEM.md §4). */

import { parseEngineManifest, parseProviderManifest, parseTransformManifest } from './manifest.ts';
import type {
  CapabilityId,
  EngineId,
  EngineManifest,
  EntityKind,
  ManifestIssue,
  ProviderId,
  ProviderManifest,
  TransformId,
  TransformManifest,
} from './types.ts';

export interface RegistryInput {
  readonly transforms: readonly unknown[];
  readonly engines: readonly unknown[];
  readonly providers: readonly unknown[];
}

export interface TransformRegistry {
  readonly transforms: readonly TransformManifest[];
  readonly engines: readonly EngineManifest[];
  readonly providers: readonly ProviderManifest[];
  transform(id: TransformId): TransformManifest | undefined;
  engine(id: EngineId): EngineManifest | undefined;
  provider(id: ProviderId): ProviderManifest | undefined;
  /** Transforms that accept this entity kind, in declaration order. */
  forInput(kind: EntityKind): readonly TransformManifest[];
  forCapability(capability: CapabilityId): readonly TransformManifest[];
  /** Engines declared by a transform, in its preference order, skipping unknown ids. */
  enginesFor(transform: TransformManifest): readonly EngineManifest[];
  validate(): readonly ManifestIssue[];
}

const index = <T, K>(items: readonly T[], key: (item: T) => K): Map<K, T> =>
  new Map(items.map((item) => [key(item), item]));

const groupBy = <T, K>(items: readonly T[], keys: (item: T) => readonly K[]): Map<K, T[]> => {
  const map = new Map<K, T[]>();
  for (const item of items) {
    for (const key of keys(item)) {
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
  }
  return map;
};

/**
 * Parses every manifest (throwing on a malformed one — a broken manifest is a build error, not a
 * runtime surprise) and builds the lookup indices.
 */
export const createTransformRegistry = (input: RegistryInput): TransformRegistry => {
  const transforms = input.transforms.map(parseTransformManifest);
  const engines = input.engines.map(parseEngineManifest);
  const providers = input.providers.map(parseProviderManifest);

  const byTransformId = index(transforms, (t) => t.id);
  const byEngineId = index(engines, (e) => e.id);
  const byProviderId = index(providers, (p) => p.id);
  const byInput = groupBy(transforms, (t) => t.inputs);
  const byCapability = groupBy(transforms, (t) => [t.capability]);

  const enginesFor = (transform: TransformManifest): readonly EngineManifest[] =>
    transform.engines
      .map((id) => byEngineId.get(id))
      .filter((engine): engine is EngineManifest => engine !== undefined);

  const validate = (): readonly ManifestIssue[] => {
    const issues: ManifestIssue[] = [];
    const seen = new Set<string>();

    for (const transform of transforms) {
      if (seen.has(transform.id)) {
        issues.push({ kind: 'transform', id: transform.id, message: 'duplicate transform id' });
      }
      seen.add(transform.id);

      for (const engineId of transform.engines) {
        const engine = byEngineId.get(engineId);
        if (!engine) {
          issues.push({
            kind: 'transform',
            id: transform.id,
            message: `references unknown engine "${engineId}"`,
          });
          continue;
        }
        // Terminal engines (link out / manual entry) serve every capability by design.
        if (!engine.terminal && engine.capability !== transform.capability) {
          issues.push({
            kind: 'transform',
            id: transform.id,
            message: `engine "${engineId}" implements "${engine.capability}", not "${transform.capability}"`,
          });
        }
      }

      const chain = enginesFor(transform);
      // Every capability must end somewhere the analyst can still act (§5): a link out or manual
      // entry. Without this a failed provider is a dead end.
      if (chain.length > 0 && !chain.some((engine) => engine.terminal)) {
        issues.push({
          kind: 'transform',
          id: transform.id,
          message: 'fallback chain has no terminal engine (external link or manual)',
        });
      }
    }

    for (const engine of engines) {
      if (!byProviderId.has(engine.provider)) {
        issues.push({
          kind: 'engine',
          id: engine.id,
          message: `references unknown provider "${engine.provider}"`,
        });
      }
    }

    for (const provider of providers) {
      for (const alternative of provider.alternatives) {
        if (!byProviderId.has(alternative)) {
          issues.push({
            kind: 'provider',
            id: provider.id,
            message: `lists unknown alternative "${alternative}"`,
          });
        }
      }
    }

    return issues;
  };

  return {
    transforms,
    engines,
    providers,
    transform: (id) => byTransformId.get(id),
    engine: (id) => byEngineId.get(id),
    provider: (id) => byProviderId.get(id),
    forInput: (kind) => byInput.get(kind) ?? [],
    forCapability: (capability) => byCapability.get(capability) ?? [],
    enginesFor,
    validate,
  };
};
