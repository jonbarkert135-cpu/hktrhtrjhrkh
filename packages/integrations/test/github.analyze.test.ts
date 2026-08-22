/**
 * Golden test for the Repository Analysis Agent (11_GITHUB.md §5, §11).
 *
 * The fixture mirrors the shape of `sherlock-project/sherlock` from §5.10 — a Python CLI with a
 * Dockerfile — and asserts the three properties the spec demands: schema-valid output, byte-stable
 * results for identical inputs, and honest degradation when the budget skips steps.
 */

import { RepositoryAnalysisSchema } from '@nexus/domain';
import { describe, expect, it } from 'vitest';

import { analyzeRepository, type AnalysisInputs } from '../github/analysis/analyze.ts';

const README = `# Sherlock

\`\`\`console
$ sherlock user123 --json --site GitHub --timeout 5
\`\`\`

Or with docker: \`docker run --rm sherlock/sherlock user123\`
`;

const inputs = (): AnalysisInputs => ({
  repoKey: 'gh:repo:sherlock-project/sherlock',
  headSha: 'a'.repeat(40),
  treeComplete: true,
  treePaths: [
    'README.md',
    'pyproject.toml',
    'Dockerfile',
    'docs/index.md',
    'tests/test_cli.py',
    '.github/workflows/ci.yml',
    'sherlock_project/__main__.py',
    'node_modules/junk/index.js',
  ],
  languagesApi: { Python: 250_000, Dockerfile: 1_000 },
  files: new Map([
    [
      'pyproject.toml',
      `[project]
name = "sherlock-project"
version = "0.16.0"
requires-python = ">=3.9"
dependencies = ["requests >= 2.31", "requests-futures", "colorama"]

[project.scripts]
sherlock = "sherlock_project.sherlock:main"
`,
    ],
    ['Dockerfile', 'FROM python:3.12-slim\nEXPOSE 8080\nENTRYPOINT ["sherlock"]\n'],
  ]),
  readme: README,
  health: {
    pushedAt: '2026-05-20T00:00:00.000Z',
    latestReleaseAt: '2025-09-16T00:00:00.000Z',
    archived: false,
    stars: 62_000,
    openIssues: 30,
    contributorsCount: 200,
    licenseSpdxId: 'MIT',
    licenseFileText: null,
  },
  producedAt: '2026-06-01T00:00:00.000Z',
  nowMs: Date.parse('2026-06-01T00:00:00.000Z'),
});

describe('analyzeRepository', () => {
  it('produces a schema-valid analysis of a python CLI repository', () => {
    const analysis = analyzeRepository(inputs());
    expect(RepositoryAnalysisSchema.parse(analysis)).toEqual(analysis);

    expect(analysis.primaryLanguage).toBe('Python');
    expect(analysis.layout.kind).toBe('single-package');
    expect(analysis.layout.docsDirs).toEqual(['docs']);
    expect(analysis.layout.testDirs).toEqual(['tests']);
    expect(analysis.layout.ciProviders).toEqual(['github-actions']);

    expect(analysis.entryPoints).toEqual([
      {
        type: 'cli',
        name: 'sherlock',
        path: 'pyproject.toml',
        runCommand: 'sherlock',
        rule: 'py.console_scripts',
        confidence: 'high',
      },
      {
        type: 'cli',
        name: 'sherlock_project',
        path: 'sherlock_project/__main__.py',
        runCommand: 'python -m sherlock_project',
        rule: 'py.dunder_main',
        confidence: 'medium',
      },
      {
        type: 'container',
        name: 'docker',
        path: 'Dockerfile',
        runCommand: 'sherlock',
        rule: 'docker.cmd',
        confidence: 'high',
      },
    ]);

    expect(analysis.dependencies).toEqual([
      {
        ecosystem: 'pip',
        path: 'pyproject.toml',
        packageName: 'sherlock-project',
        direct: 3,
        dev: 0,
        truncated: 0,
        top: [
          { name: 'requests', range: '>= 2.31', scope: 'runtime' },
          { name: 'requests-futures', range: null, scope: 'runtime' },
          { name: 'colorama', range: null, scope: 'runtime' },
        ],
        parseErrors: [],
      },
    ]);

    expect(analysis.surface.cli[0]?.flags).toEqual(['--json', '--site', '--timeout']);
    expect(analysis.surface.http.routesKnown).toBe(false);
    expect(analysis.container.baseImages).toEqual(['python:3.12-slim']);
    expect(analysis.container.rootUser).toBe(true);
    expect(analysis.container.publishedImageHints).toEqual(['sherlock/sherlock']);
    expect(analysis.health.maintenanceBand).toBe('healthy');
    expect(analysis.build.runtimeVersions).toEqual({ python: '>=3.9' });
    expect(analysis.completeness).toBe(1);
    // Step J belongs to the LLM pass; the deterministic core never fills it.
    expect(analysis.narrative.summary).toBeNull();
  });

  it('is deterministic: identical inputs give identical output and digest', () => {
    expect(analyzeRepository(inputs())).toEqual(analyzeRepository(inputs()));
    expect(analyzeRepository(inputs()).inputsDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the digest when the head sha changes', () => {
    const other = { ...inputs(), headSha: 'b'.repeat(40) };
    expect(analyzeRepository(other).inputsDigest).not.toBe(
      analyzeRepository(inputs()).inputsDigest,
    );
  });

  it('labels a partial analysis instead of failing it', () => {
    const partial = analyzeRepository({
      ...inputs(),
      files: new Map(),
      treeComplete: false,
      skippedSteps: ['keyfiles', 'deps', 'health'],
    });
    expect(RepositoryAnalysisSchema.parse(partial)).toEqual(partial);
    expect(partial.completeness).toBe(0.7);
    expect(partial.treeComplete).toBe(false);
    expect(partial.dependencies).toEqual([]);
    expect(partial.container.dockerfile).toBeNull();
  });

  it('handles a monorepo with compose services and no README', () => {
    const analysis = analyzeRepository({
      ...inputs(),
      languagesApi: {},
      readme: null,
      treePaths: ['apps/web/package.json', 'services/api/package.json', 'docker-compose.yml'],
      files: new Map([
        ['apps/web/package.json', '{"name":"web","scripts":{"dev":"vite"}}'],
        ['services/api/package.json', '{"name":"api","dependencies":{"fastify":"^4"}}'],
        ['docker-compose.yml', 'services:\n  api:\n    image: ghcr.io/demo/api\n'],
      ]),
    });
    expect(analysis.layout.kind).toBe('monorepo');
    expect(analysis.surface.http.framework).toBe('fastify');
    expect(analysis.container.compose).toEqual(['docker-compose.yml']);
    expect(analysis.container.publishedImageHints).toEqual(['ghcr.io/demo/api']);
    expect(analysis.entryPoints.some((entry) => entry.rule === 'compose.service')).toBe(true);
  });
});
