/** Small hand-built registry so routing tests do not depend on the shipped catalogue. */

import type { ModeContext } from '../src/modes.ts';
import { createTransformRegistry, type RegistryInput } from '../src/registry.ts';
import type {
  EngineManifest,
  ExecutionMode,
  Permission,
  ProviderManifest,
  TransformManifest,
} from '../src/types.ts';

export const makeProvider = (
  over: Partial<ProviderManifest> & { id: string },
): ProviderManifest => ({
  name: over.id,
  credentialClass: 'A',
  credentials: 'none',
  pricing: 'free',
  licence: 'MIT',
  limits: {},
  lastVerified: '2026-08-19',
  status: 'configured',
  alternatives: [],
  ...over,
});

export const makeEngine = (
  over: Partial<EngineManifest> & { id: string; capability: string; provider: string },
): EngineManifest => ({
  version: '1.0.0',
  dataFlow: 'network',
  permissions: ['network'],
  quality: { resultQuality: 0.8, reliability: 0.8, maintenance: 0.8 },
  cost: 'standard',
  terminal: false,
  status: 'stable',
  ...over,
});

export const makeTransform = (
  over: Partial<TransformManifest> & { id: string; capability: string },
): TransformManifest => ({
  version: '1.0.0',
  name: over.id,
  description: over.id,
  category: 'infrastructure',
  inputs: ['domain'],
  outputs: ['ip'],
  engines: ['engine-a', 'manual-entry'],
  priority: 'core',
  cost: 'standard',
  limits: { expectedRuntimeMs: 1_000, maxResults: 10, maxInputBatch: 10 },
  cacheable: false,
  documentation: 'docs/ecosystem/TRANSFORM_CATALOG.md',
  status: 'stable',
  ...over,
});

export const MANUAL_ENGINE = makeEngine({
  id: 'manual-entry',
  capability: 'terminal',
  provider: 'manual',
  dataFlow: 'local',
  permissions: [],
  cost: 'optional',
  terminal: true,
  quality: { resultQuality: 0.3, reliability: 1, maintenance: 1 },
});

export const MANUAL_PROVIDER = makeProvider({ id: 'manual', pricing: 'local' });

export const buildRegistry = (input: Partial<RegistryInput> = {}) =>
  createTransformRegistry({
    transforms: input.transforms ?? [makeTransform({ id: 'domain-to-ip', capability: 'dns' })],
    engines: input.engines ?? [
      makeEngine({ id: 'engine-a', capability: 'dns', provider: 'provider-a' }),
      MANUAL_ENGINE,
    ],
    providers: input.providers ?? [makeProvider({ id: 'provider-a' }), MANUAL_PROVIDER],
  });

export const ALL_PERMISSIONS: readonly Permission[] = [
  'network',
  'filesystem',
  'subprocess',
  'credentials',
  'browser',
];

export const ctx = (
  mode: ExecutionMode = 'configured',
  configured: readonly string[] = [],
  permissions: readonly Permission[] = ALL_PERMISSIONS,
): ModeContext => ({
  mode,
  configuredProviders: new Set(configured),
  grantedPermissions: new Set(permissions),
});
