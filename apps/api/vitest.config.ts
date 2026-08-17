import { mergeConfig } from 'vitest/config';
import { nodeConfig, COVERAGE_TARGETS } from '@nexus/config/vitest';

export default mergeConfig(nodeConfig({ coverage: COVERAGE_TARGETS['apps/api'] }), {
  test: {
    // Tests that boot a Fastify instance pay a one-time ~0.5-1.4 s boot cost. On a loaded CI
    // runner (12 turbo tasks in parallel) that overshoots the 5 s unit default and produced a
    // flake in test/test-endpoints-guard.test.ts. The assertions stay unit-sized; only the
    // ceiling for process contention is raised, and only for this app.
    testTimeout: 20_000,
    coverage: {
      // Server bootstrap: needs a live listener, DB and Redis. Covered by the e2e job.
      exclude: ['src/server.ts'],
    },
  },
});
