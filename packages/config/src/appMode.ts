/**
 * The single source of truth for "what is switched on in this deployment".
 *
 * Raven runs in two shapes and only two:
 *
 *   APP_MODE=local   the default. One person, one browser, no account, no server, no cloud.
 *                    Everything is stored on the device. Nothing may be reached over the network.
 *   APP_MODE=server  a full deployment: API, database, accounts, and later sync and collaboration.
 *
 * Every optional subsystem is named here and nowhere else. Product code never reads
 * `process.env.SOMETHING_ENABLED` and never asks "is this local?" — it asks the capability it
 * actually needs (`caps.auth`, `caps.cloudSync`, …). That keeps mode-awareness out of the UI and
 * makes turning a subsystem on a one-line change in a deployment, not a code change.
 *
 * The resolver is deliberately strict: in local mode enabling any capability is a configuration
 * error, and a capability whose dependency is off is a configuration error. A half-configured
 * deployment fails at boot with a sentence that says what to fix, instead of failing at runtime
 * with a network error the user cannot interpret.
 */

export const APP_MODES = ['local', 'server'] as const;
export type AppMode = (typeof APP_MODES)[number];

export const DEFAULT_APP_MODE: AppMode = 'local';

/**
 * Capability → the environment variable that overrides it. Order matters only for message
 * readability; dependencies are declared separately.
 */
export const CAPABILITY_ENV = {
  backend: 'BACKEND_ENABLED',
  auth: 'AUTH_ENABLED',
  googleAuth: 'GOOGLE_AUTH_ENABLED',
  cloudSync: 'CLOUD_SYNC_ENABLED',
  remoteDatabase: 'REMOTE_DATABASE_ENABLED',
  collaboration: 'COLLABORATION_ENABLED',
  integrations: 'INTEGRATIONS_ENABLED',
} as const;

export type Capability = keyof typeof CAPABILITY_ENV;

export const CAPABILITIES = Object.keys(CAPABILITY_ENV) as readonly Capability[];

export type Capabilities = Readonly<Record<Capability, boolean>>;

/**
 * What each capability needs underneath it. `auth` without `backend` is not a degraded mode, it is
 * a contradiction: there is nothing to authenticate against.
 */
const REQUIRES: Readonly<Record<Capability, readonly Capability[]>> = {
  backend: [],
  auth: ['backend'],
  googleAuth: ['auth'],
  cloudSync: ['backend'],
  remoteDatabase: ['backend'],
  collaboration: ['backend', 'cloudSync'],
  // Tool execution is inherently server-side (N5: sandboxed runner, never in-process), so there is
  // no meaningful local-only mode for it. In APP_MODE=local the whole integrations surface is
  // absent, not disabled (ADR-002, P9 §3).
  integrations: ['backend'],
};

const ALL_OFF: Capabilities = {
  backend: false,
  auth: false,
  googleAuth: false,
  cloudSync: false,
  remoteDatabase: false,
  collaboration: false,
  integrations: false,
};

/**
 * Mode defaults. `server` turns on what exists and is finished today; sync, collaboration and
 * Google sign-in stay off until their phases land, and are then enabled per deployment.
 */
export const MODE_DEFAULTS: Readonly<Record<AppMode, Capabilities>> = {
  local: ALL_OFF,
  server: { ...ALL_OFF, backend: true, auth: true, remoteDatabase: true },
};

export class AppModeConfigError extends Error {
  // Plain field + assignment: parameter properties are not erasable and therefore unsupported by
  // `node --experimental-strip-types` (see infra/docker/api.Dockerfile).
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid application mode configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'AppModeConfigError';
    this.issues = issues;
  }
}

const isAppMode = (value: string): value is AppMode =>
  (APP_MODES as readonly string[]).includes(value);

/** Parses APP_MODE. An unset value is `local`; an unknown value is a boot error, never a guess. */
export function parseAppMode(raw: string | undefined): AppMode {
  const value = (raw ?? '').trim();
  if (value === '') return DEFAULT_APP_MODE;
  if (!isAppMode(value)) {
    throw new AppModeConfigError([
      `APP_MODE="${value}" is not a mode. Use one of: ${APP_MODES.join(', ')}.`,
    ]);
  }
  return value;
}

/** Strict boolean parsing: only `true`/`false` (any case). Anything else is a typo worth failing on. */
function parseBool(name: string, raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === '') return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new AppModeConfigError([`${name}="${raw}" is not a boolean. Use true or false.`]);
}

export type CapabilityOverrides = Partial<Record<Capability, boolean>>;

/**
 * Applies the mode defaults, then the explicit overrides, then validates. Returns a frozen record
 * so nothing downstream can flip a capability at runtime.
 */
export function resolveCapabilities(
  mode: AppMode,
  overrides: CapabilityOverrides = {},
): Capabilities {
  const base = MODE_DEFAULTS[mode];
  const resolved: Record<Capability, boolean> = { ...base };
  const issues: string[] = [];

  for (const capability of CAPABILITIES) {
    const override = overrides[capability];
    if (override === undefined) continue;
    if (mode === 'local' && override) {
      issues.push(
        `${CAPABILITY_ENV[capability]}=true is not possible while APP_MODE=local. ` +
          `Set APP_MODE=server first — local mode must run with no network dependency at all.`,
      );
      continue;
    }
    resolved[capability] = override;
  }

  for (const capability of CAPABILITIES) {
    if (!resolved[capability]) continue;
    for (const dependency of REQUIRES[capability]) {
      if (!resolved[dependency]) {
        issues.push(
          `${CAPABILITY_ENV[capability]}=true requires ${CAPABILITY_ENV[dependency]}=true.`,
        );
      }
    }
  }

  if (issues.length > 0) throw new AppModeConfigError(issues);
  return Object.freeze(resolved);
}

/** A record of environment variables, as read from `process.env` or Vite's `import.meta.env`. */
export type EnvRecord = Readonly<Record<string, string | undefined>>;

export interface AppModeConfig {
  readonly mode: AppMode;
  readonly capabilities: Capabilities;
}

/**
 * Reads the mode configuration out of an environment record. `prefix` exists because the browser
 * bundle only receives `VITE_`-prefixed variables; the names are otherwise identical, so a
 * deployment configures one set of concepts rather than two vocabularies.
 */
export function readAppModeConfig(env: EnvRecord, prefix = ''): AppModeConfig {
  const mode = parseAppMode(env[`${prefix}APP_MODE`]);
  const overrides: CapabilityOverrides = {};
  for (const capability of CAPABILITIES) {
    const name = `${prefix}${CAPABILITY_ENV[capability]}`;
    const value = parseBool(name, env[name]);
    if (value !== undefined) overrides[capability] = value;
  }
  return { mode, capabilities: resolveCapabilities(mode, overrides) };
}

/** True when the process/bundle must behave as if the network does not exist. */
export const isLocalOnly = (config: AppModeConfig): boolean => !config.capabilities.backend;
