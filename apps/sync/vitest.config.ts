import { mergeConfig } from 'vitest/config';
import { nodeConfig, COVERAGE_TARGETS } from '@nexus/config/vitest';

export default mergeConfig(nodeConfig({ coverage: COVERAGE_TARGETS['apps/sync'] }), {
  test: {
    testTimeout: 20_000,
    coverage: {
      // Boots a real Hocuspocus/WS listener; covered by the e2e collab suite instead.
      exclude: ['src/server.ts'],
    },
  },
});
