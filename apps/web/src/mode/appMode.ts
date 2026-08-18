/**
 * The browser's view of the mode registry (packages/config/src/appMode.ts).
 *
 * Read once at module load from Vite's `import.meta.env`, because the answer cannot change while
 * the tab is open: the bundle was built for one deployment shape. Components never test the mode
 * directly — they ask for the capability they need (`caps.auth`, `caps.backend`), which is what
 * keeps "local" from leaking into a hundred conditionals.
 */
import { readAppModeConfig, type AppModeConfig, type EnvRecord } from '@nexus/config/app-mode';

/**
 * `import.meta.env` typed as a plain record. Vite injects only `VITE_`-prefixed variables plus its
 * own MODE/DEV/PROD, so nothing secret can arrive here.
 */
const viteEnv = (): EnvRecord => import.meta.env;

/** Exported for tests: resolves a config from any environment record. */
export const resolveAppModeConfig = (env: EnvRecord = viteEnv()): AppModeConfig =>
  readAppModeConfig(env, 'VITE_');

const config: AppModeConfig = resolveAppModeConfig();

export const appMode = config.mode;
export const capabilities = config.capabilities;

/** True when this build must behave as if the network does not exist. */
export const localOnly = !config.capabilities.backend;
