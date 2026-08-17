import { mergeConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { jsdomConfig, COVERAGE_TARGETS } from '@nexus/config/vitest';

export default mergeConfig(jsdomConfig({ coverage: COVERAGE_TARGETS['apps/web'] }), {
  plugins: [react()],
  test: { globals: true, include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['./src/test/setup.ts'] },
});
