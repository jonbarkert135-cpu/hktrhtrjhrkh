/**
 * Build/deploy feature flags — NEXUS-SPEC/19_DEPLOYMENT.md §9.
 * Closed union: an unknown name in FEATURE_FLAGS is a configuration error, not a no-op.
 * Flags gate unfinished surfaces only, never a security control.
 */
export const FLAG_NAMES = [
  'ai.summarize',
  'ai.suggestLinks',
  'views.map',
  'views.timeline',
  'presentation.mode',
  'export.report',
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];

const isFlagName = (v: string): v is FlagName => (FLAG_NAMES as readonly string[]).includes(v);

export class UnknownFlagError extends Error {
  constructor(public readonly unknown: readonly string[]) {
    super(`Unknown feature flag(s): ${unknown.join(', ')}. Known flags: ${FLAG_NAMES.join(', ')}`);
    this.name = 'UnknownFlagError';
  }
}

export interface Flags {
  readonly enabled: ReadonlySet<FlagName>;
  isEnabled(flag: FlagName): boolean;
}

/** Parse the FEATURE_FLAGS csv. Throws UnknownFlagError so boot fails on a typo. */
export function parseFlags(csv: string): Flags {
  const names = csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const unknown = names.filter((n) => !isFlagName(n));
  if (unknown.length > 0) throw new UnknownFlagError(unknown);
  const enabled = new Set<FlagName>(names.filter(isFlagName));
  return { enabled, isEnabled: (flag) => enabled.has(flag) };
}
