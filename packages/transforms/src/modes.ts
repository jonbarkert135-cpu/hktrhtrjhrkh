/** Execution-mode filtering (21_TRANSFORM_SYSTEM.md §7). */

import type {
  EngineManifest,
  ExclusionReason,
  ExecutionMode,
  Permission,
  ProviderManifest,
} from './types.ts';

export interface ModeContext {
  readonly mode: ExecutionMode;
  /** Providers the user has actually configured credentials for. */
  readonly configuredProviders: ReadonlySet<string>;
  /** Permissions the workspace grants; an engine needing more is refused. */
  readonly grantedPermissions: ReadonlySet<Permission>;
}

const MODE_RANK: Record<ExecutionMode, number> = {
  'strict-local': 0,
  'zero-credential': 1,
  'free-tier': 2,
  configured: 3,
  'maximum-coverage': 4,
};

/**
 * Why this engine cannot run, or `undefined` when it can. Order matters: the most specific,
 * most actionable reason wins, because the UI turns it into the offer it makes the user.
 */
export const engineExclusion = (
  engine: EngineManifest,
  provider: ProviderManifest,
  ctx: ModeContext,
): ExclusionReason | undefined => {
  if (engine.status === 'unavailable') return 'engine-unavailable';
  if (engine.status === 'deprecated' || provider.status === 'deprecated') {
    return 'provider-deprecated';
  }
  // E (link out) and F (out of scope) never execute, in any mode.
  if (provider.credentialClass === 'E' || provider.credentialClass === 'F') {
    return engine.terminal ? undefined : 'not-executable';
  }
  if (engine.permissions.some((permission) => !ctx.grantedPermissions.has(permission))) {
    return 'permission-denied';
  }

  const rank = MODE_RANK[ctx.mode];
  const isLocal = engine.dataFlow === 'local';
  if (rank === MODE_RANK['strict-local'] && !isLocal) return 'blocked-by-mode';
  // `credentials: 'optional'` means an anonymous path exists (GitHub's 60 req/h, for example),
  // so it stays allowed here; only a hard key requirement is blocked.
  if (rank <= MODE_RANK['zero-credential'] && !isLocal && provider.credentials === 'required') {
    return 'blocked-by-mode';
  }
  if (rank <= MODE_RANK['free-tier'] && provider.pricing === 'paid') return 'paid-only';

  if (provider.status === 'disabled') return 'provider-unavailable';
  if (provider.status === 'unavailable') return 'provider-unavailable';
  if (provider.status === 'rate-limited') return 'provider-rate-limited';
  if (provider.status === 'invalid') return 'requires-configuration';
  if (provider.credentials === 'required' && !ctx.configuredProviders.has(provider.id)) {
    return 'requires-configuration';
  }
  return undefined;
};
