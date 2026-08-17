import { mergeConfig } from 'vitest/config';
import { nodeConfig, COVERAGE_TARGETS } from '@nexus/config/vitest';

export default mergeConfig(nodeConfig({ coverage: COVERAGE_TARGETS['apps/api'] }), {
  test: {
    coverage: {
      // Server bootstrap: needs a live listener, DB and Redis. Covered by the e2e job.
      exclude: ['src/server.ts'],
    },
  },
});
