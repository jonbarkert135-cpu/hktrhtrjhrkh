import { loadServerEnv } from '@nexus/config';
import { loadServerEnvFromProcess } from '@nexus/config/env-file';

/** The validated server env shape, owned by `packages/config` (19_DEPLOYMENT.md §1.1). */
export type ServerEnv = ReturnType<typeof loadServerEnv>;

export { loadServerEnv, loadServerEnvFromProcess };
