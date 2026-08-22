/** RepositoryAnalysis schema (11_GITHUB.md §5.10): the analysis contract, not the analyser. */

import { describe, expect, it } from 'vitest';

import { ANALYZER_VERSION, RepositoryAnalysisSchema } from '../src/entities/repository-analysis.ts';

const minimal = {
  repoKey: 'sherlock-project/sherlock',
  headSha: 'a'.repeat(40),
  inputsDigest: 'b'.repeat(64),
  analyzerVersion: ANALYZER_VERSION,
  producedAt: '2026-01-01T00:00:00.000Z',
  completeness: 1,
  skippedSteps: [],
  treeComplete: true,
  languages: [{ name: 'Python', bytes: 100, pct: 100, source: 'api' as const }],
  primaryLanguage: 'Python',
  layout: {
    kind: 'single-package' as const,
    packages: [],
    docsDirs: [],
    testDirs: [],
    ciProviders: [],
  },
  entryPoints: [],
  build: { systems: [], commands: [], runtimeVersions: {} },
  dependencies: [],
  surface: {
    cli: [],
    http: { spec: null, framework: null, routesKnown: false, routes: [] },
    grpc: [],
    library: false,
    mcp: false,
  },
  container: {
    dockerfile: null,
    compose: [],
    baseImages: [],
    exposedPorts: [],
    publishedImageHints: [],
    rootUser: null,
  },
  health: {
    license: { spdxId: 'MIT', method: 'api' as const, permissive: true },
    maintenanceScore: 80,
    maintenanceBand: 'healthy' as const,
    signals: [],
    archived: false,
    contributorsCount: null,
  },
  narrative: {
    summary: null,
    architecture: null,
    integrationNotes: null,
    model: null,
    generatedAt: null,
  },
};

describe('RepositoryAnalysisSchema', () => {
  it('accepts a complete analysis', () => {
    expect(RepositoryAnalysisSchema.parse(minimal).repoKey).toBe('sherlock-project/sherlock');
  });

  it('rejects out-of-range completeness', () => {
    expect(() => RepositoryAnalysisSchema.parse({ ...minimal, completeness: 2 })).toThrow();
  });
});
