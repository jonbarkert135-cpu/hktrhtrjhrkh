import { mergeConfig } from 'vitest/config';
import { jsdomConfig, COVERAGE_TARGETS } from '@nexus/config/vitest';

export default mergeConfig(jsdomConfig({ coverage: COVERAGE_TARGETS['packages/ui'] }), {
  test: { globals: true, include: ['test/**/*.test.{ts,tsx}'] },
  esbuild: { jsx: 'automatic' },
});
