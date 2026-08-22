import { defineConfig } from 'vitest/config';
import type { UserConfig } from 'vitest/config';

export interface CoverageThresholds {
  lines: number;
  branches: number;
}

export interface BaseOptions {
  /** Coverage floors from 18_TESTING.md §14. Omit for packages without a hard gate. */
  coverage?: CoverageThresholds;
  /** Extra setup files (e.g. jest-dom) merged after the defaults. */
  setupFiles?: string[];
}

const common = (environment: 'node' | 'jsdom', options: BaseOptions): UserConfig =>
  defineConfig({
    test: {
      environment,
      globals: false, // explicit imports; no ambient magic
      restoreMocks: true,
      clearMocks: true,
      unstubEnvs: true,
      testTimeout: 5_000, // a unit test above 5 s is a design bug
      hookTimeout: 10_000,
      pool: 'threads',
      sequence: { shuffle: true, seed: Number(process.env.VITEST_SEED ?? 0) },
      ...(options.setupFiles ? { setupFiles: options.setupFiles } : {}),
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'json', 'json-summary', 'lcov'],
        // Barrels re-export, build scripts are not shipped code: neither says anything about risk.
        exclude: [
          '**/index.ts',
          'scripts/**',
          'seed/**',
          'tailwind/**',
          '**/*.config.*',
          'test/**',
          'dist/**',
        ],
        ...(options.coverage
          ? { thresholds: { lines: options.coverage.lines, branches: options.coverage.branches } }
          : {}),
      },
    },
  });

/** Node-environment package config. */
export const nodeConfig = (options: BaseOptions = {}): UserConfig => common('node', options);

/** Browser-ish (jsdom) config for React component tests. */
export const jsdomConfig = (options: BaseOptions = {}): UserConfig => common('jsdom', options);

/** Coverage floors per 18_TESTING.md §14, keyed by workspace path. */
export const COVERAGE_TARGETS = {
  'packages/domain': { lines: 90, branches: 85 },
  'packages/canvas-engine': { lines: 85, branches: 80 },
  // Layout is pure geometry: lines are held higher than the §14 floor, branches lower on purpose.
  // Most of its remaining branches are `?? fallback` guards against a node that cannot exist in a
  // validated graph; a test that fakes one would assert the test double, not the algorithm.
  'packages/layout': { lines: 95, branches: 75 },
  'packages/integrations': { lines: 85, branches: 75 },
  'packages/ai': { lines: 85, branches: 75 },
  'packages/transforms': { lines: 90, branches: 85 },
  'packages/ui': { lines: 70, branches: 60 },
  'apps/api': { lines: 80, branches: 70 },
  'apps/sync': { lines: 75, branches: 65 },
  'apps/worker': { lines: 75, branches: 65 },
  'apps/runner': { lines: 70, branches: 60 },
  'apps/web': { lines: 60, branches: 50 },
} as const satisfies Record<string, CoverageThresholds>;
