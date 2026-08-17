import { describe, expect, it } from 'vitest';
import { loadServerEnv, loadServerEnvFromProcess } from '../src/env.ts';

// `apps/api/src/env.ts` is a re-export seam: the schema lives in `@nexus/config` (19_DEPLOYMENT.md
// §1.1) and the file exists so the app has a single import site. The obligation here is that the
// seam keeps exporting both loaders — a rename in config must break a test, not the boot.
describe('apps/api env seam', () => {
  it('re-exports both server env loaders', () => {
    expect(typeof loadServerEnv).toBe('function');
    expect(typeof loadServerEnvFromProcess).toBe('function');
  });

  it('validates through the shared schema (missing vars are rejected)', () => {
    expect(() => loadServerEnv({})).toThrow();
  });
});
