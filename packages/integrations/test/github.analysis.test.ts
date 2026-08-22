/** Deterministic analysis steps C–I (11_GITHUB.md §5.3–§5.8). */

import { describe, expect, it } from 'vitest';

import { composeServices, imageHints, parseDockerfile } from '../github/analysis/container.ts';
import { detectEntryPoints } from '../github/analysis/entrypoints.ts';
import { detectLicense, scoreMaintenance, type HealthInput } from '../github/analysis/health.ts';
import { detectLanguages, primaryLanguage } from '../github/analysis/languages.ts';
import { detectSurface, readmeFlags } from '../github/analysis/surface.ts';
import { classifyLayout, filterTree } from '../github/analysis/tree.ts';
import { parseManifests } from '../github/parsers/index.ts';

const NOW = Date.parse('2026-06-01T00:00:00.000Z');

describe('languages', () => {
  it('prefers the API byte counts', () => {
    const languages = detectLanguages({ Python: 900, Shell: 100 }, ['a.rs']);
    expect(languages).toEqual([
      { name: 'Python', bytes: 900, pct: 90, source: 'api' },
      { name: 'Shell', bytes: 100, pct: 10, source: 'api' },
    ]);
    expect(primaryLanguage(languages)).toBe('Python');
  });

  it('falls back to an extension histogram, marked heuristic', () => {
    const languages = detectLanguages({}, ['a.ts', 'b.tsx', 'c.py', 'notes.md']);
    expect(languages[0]).toEqual({ name: 'TypeScript', bytes: 0, pct: 66.67, source: 'heuristic' });
    expect(primaryLanguage(languages)).toBe('TypeScript');
  });

  it('returns null when nothing is recognisable', () => {
    expect(primaryLanguage(detectLanguages({}, ['LICENSE']))).toBeNull();
  });

  it('falls back to the largest language when none reaches 15 percent', () => {
    const languages = detectLanguages(
      { A: 10, B: 9, C: 9, D: 9, E: 9, F: 9, G: 9, H: 9, I: 9, J: 9, K: 9 },
      [],
    );
    expect(primaryLanguage(languages)).toBe('A');
  });
});

describe('tree', () => {
  it('drops vendored directories and very deep paths', () => {
    expect(
      filterTree(['src/a.ts', 'node_modules/x/index.js', 'dist/a.js', `${'d/'.repeat(13)}a.ts`]),
    ).toEqual(['src/a.ts']);
  });

  it('classifies layout, docs, tests and CI', () => {
    const manifests = parseManifests(
      new Map([
        ['packages/a/package.json', '{"name":"a"}'],
        ['packages/b/package.json', '{"name":"b"}'],
      ]),
    );
    const layout = classifyLayout(
      ['docs/x.md', 'tests/y.py', '.github/workflows/ci.yml'],
      manifests,
    );
    expect(layout.kind).toBe('monorepo');
    expect(layout.packages).toEqual([
      { path: 'packages/a', ecosystem: 'npm', name: 'a' },
      { path: 'packages/b', ecosystem: 'npm', name: 'b' },
    ]);
    expect(layout.docsDirs).toEqual(['docs']);
    expect(layout.testDirs).toEqual(['tests']);
    expect(layout.ciProviders).toEqual(['github-actions']);
  });

  it('calls a mixed-ecosystem tree multi-module and an empty one unknown', () => {
    const mixed = parseManifests(
      new Map([
        ['services/api/package.json', '{"name":"api"}'],
        ['services/worker/go.mod', 'module x\n'],
      ]),
    );
    expect(classifyLayout([], mixed).kind).toBe('multi-module');
    expect(classifyLayout([], []).kind).toBe('unknown');
    expect(classifyLayout([], parseManifests(new Map([['package.json', '{}']]))).kind).toBe(
      'single-package',
    );
  });

  it('recognises gitlab and circleci', () => {
    const layout = classifyLayout(['.gitlab-ci.yml', '.circleci/config.yml'], []);
    expect(layout.ciProviders).toEqual(['gitlab-ci', 'circleci']);
  });
});

describe('container', () => {
  it('reads FROM, EXPOSE, USER and the run command', () => {
    const parsed = parseDockerfile(
      'Dockerfile',
      `FROM python:3.12-slim AS base
EXPOSE 8080/tcp 9090
USER app
ENTRYPOINT ["python", "-m", "sherlock"]
CMD ["--help"]
`,
    );
    expect(parsed.baseImages).toEqual(['python:3.12-slim']);
    expect(parsed.exposedPorts).toEqual([8080, 9090]);
    expect(parsed.rootUser).toBe(false);
    expect(parsed.command).toBe('python -m sherlock --help');
  });

  it('treats a missing USER directive as root', () => {
    const parsed = parseDockerfile('Dockerfile', 'FROM alpine\nCMD sh -c "echo hi"\n');
    expect(parsed.rootUser).toBe(true);
    expect(parsed.command).toBe('sh -c "echo hi"');
  });

  it('lists compose services and image hints without verifying them', () => {
    const compose = `services:
  api:
    image: ghcr.io/demo/api:1.2
  worker:
    build: .
volumes:
  data:
`;
    expect(composeServices(compose)).toEqual(['api', 'worker']);
    expect(imageHints(compose)).toEqual(['ghcr.io/demo/api:1.2']);
    expect(imageHints('run it: `docker run --rm sherlock/sherlock user1`')).toEqual([
      'sherlock/sherlock',
    ]);
  });
});

describe('entry points', () => {
  it('emits npm bins, scripts, library entry and node engine', () => {
    const manifests = parseManifests(
      new Map([
        [
          'package.json',
          JSON.stringify({
            name: 'demo',
            bin: { demo: 'cli.js' },
            main: 'index.js',
            engines: { node: '>=22' },
            scripts: { start: 'node .', build: 'tsc', test: 'vitest', lint: 'eslint .' },
          }),
        ],
      ]),
    );
    const result = detectEntryPoints(manifests, [], new Map());
    expect(result.entryPoints.map((e) => [e.rule, e.runCommand])).toEqual([
      ['npm.bin', 'npx demo'],
      ['npm.scripts', 'npm run start'],
      ['npm.main', null],
    ]);
    expect(result.commands.map((c) => c.command)).toEqual([
      'npm run start',
      'npm run build',
      'npm run test',
      'npm run lint',
      'npm install',
    ]);
    expect(result.runtimeVersions).toEqual({ node: '>=22' });
    expect(result.systems).toEqual(['npm']);
  });

  it('emits conventional go, rust and python entries at medium confidence', () => {
    const result = detectEntryPoints(
      parseManifests(new Map([['go.mod', 'module demo\ngo 1.22\n']])),
      ['cmd/tool/main.go', 'main.go', 'src/main.rs', 'pkg/__main__.py'],
      new Map(),
    );
    expect(result.entryPoints.map((e) => [e.rule, e.runCommand, e.confidence])).toEqual([
      ['go.cmd', 'go run ./cmd/tool', 'medium'],
      ['go.rootmain', 'go run .', 'medium'],
      ['cargo.bin', 'cargo run', 'medium'],
      ['py.dunder_main', 'python -m pkg', 'medium'],
    ]);
  });

  it('emits python console scripts, docker, compose and make targets', () => {
    const files = new Map([
      [
        'pyproject.toml',
        '[project]\nname = "s"\nrequires-python = ">=3.9"\n\n[project.scripts]\nsherlock = "s:main"\n',
      ],
      ['Dockerfile', 'FROM python\nCMD ["sherlock"]\n'],
      ['docker-compose.yml', 'services:\n  api:\n    build: .\n'],
      ['Makefile', 'run:\n\tpython -m s\ninstall:\n\tpip install .\n'],
    ]);
    const result = detectEntryPoints(parseManifests(files), ['Dockerfile'], files);
    expect(result.entryPoints.map((e) => e.rule)).toEqual([
      'py.console_scripts',
      'docker.cmd',
      'compose.service',
    ]);
    expect(result.systems).toEqual(['docker', 'make', 'pip']);
    expect(result.commands.some((c) => c.command === 'make run')).toBe(true);
    expect(result.runtimeVersions).toEqual({ python: '>=3.9' });
  });

  it('emits cargo bins and build commands', () => {
    const result = detectEntryPoints(
      parseManifests(new Map([['Cargo.toml', '[package]\nname = "d"\n\n[[bin]]\nname = "cli"\n']])),
      [],
      new Map(),
    );
    expect(result.entryPoints[0]?.runCommand).toBe('cargo run --bin cli');
    expect(result.commands[0]?.command).toBe('cargo build --release');
  });
});

describe('surface', () => {
  it('collects README flags but never invents HTTP routes', () => {
    const manifests = parseManifests(
      new Map([
        [
          'package.json',
          JSON.stringify({ name: 'api', main: 'i.js', dependencies: { express: '^4' } }),
        ],
      ]),
    );
    const { entryPoints } = detectEntryPoints(manifests, [], new Map());
    const surface = detectSurface(
      entryPoints,
      manifests,
      new Map(),
      [],
      '```\ntool --json --site x\n```',
    );
    expect(surface.http).toEqual({
      spec: null,
      framework: 'express',
      routesKnown: false,
      routes: [],
    });
    expect(surface.library).toBe(true);
    expect(readmeFlags('```\nx --json -v\n```')).toEqual(['--json', '-v']);
  });

  it('reads routes from an openapi spec and services from protos', () => {
    const files = new Map([
      ['openapi.yaml', 'paths:\n  /users:\n    get: {}\n  /users/{id}:\n    get: {}\n'],
      ['api.proto', 'service Users {}\nservice Admin {}\n'],
    ]);
    const surface = detectSurface([], [], files, ['openapi.yaml', 'api.proto'], null);
    expect(surface.http.spec).toBe('openapi.yaml');
    expect(surface.http.routes).toEqual(['/users', '/users/{id}']);
    expect(surface.http.routesKnown).toBe(true);
    expect(surface.grpc).toEqual(['Users', 'Admin']);
  });

  it('detects MCP from an mcp.json or a dependency', () => {
    expect(detectSurface([], [], new Map(), ['mcp.json'], null).mcp).toBe(true);
    const manifests = parseManifests(
      new Map([
        ['package.json', JSON.stringify({ dependencies: { '@modelcontextprotocol/sdk': '1' } })],
      ]),
    );
    expect(detectSurface([], manifests, new Map(), [], null).mcp).toBe(true);
  });
});

describe('health', () => {
  const base: HealthInput = {
    pushedAt: '2026-05-25T00:00:00.000Z',
    latestReleaseAt: '2026-04-01T00:00:00.000Z',
    archived: false,
    stars: 10_000,
    openIssues: 50,
    contributorsCount: 40,
    licenseSpdxId: 'MIT',
    licenseFileText: null,
  };

  it('scores an active, popular, licensed repository as healthy', () => {
    const health = scoreMaintenance(base, NOW);
    expect(health.maintenanceBand).toBe('healthy');
    expect(health.maintenanceScore).toBeLessThan(20);
    expect(health.license).toEqual({ spdxId: 'MIT', method: 'api', permissive: true });
    expect(health.signals.map((s) => s.signal)).toEqual([
      'staleness',
      'release cadence',
      'archived',
      'contributors',
      'license',
      'popularity',
    ]);
  });

  it('saturates the staleness terms for an abandoned repository', () => {
    const health = scoreMaintenance(
      {
        ...base,
        pushedAt: '2024-01-01T00:00:00.000Z',
        latestReleaseAt: null,
        stars: 3,
        contributorsCount: 1,
        licenseSpdxId: null,
        licenseFileText: null,
      },
      NOW,
    );
    expect(health.maintenanceScore).toBeGreaterThanOrEqual(70);
    expect(health.maintenanceBand).toBe('unmaintained');
  });

  it('adds points for an archived repository', () => {
    const archived = scoreMaintenance({ ...base, archived: true }, NOW);
    expect(archived.maintenanceScore).toBeGreaterThan(scoreMaintenance(base, NOW).maintenanceScore);
    expect(['watch', 'at-risk', 'unmaintained']).toContain(archived.maintenanceBand);
  });

  it('scores unknown dates as zero rather than guessing', () => {
    const unknown = scoreMaintenance(
      { ...base, pushedAt: null, latestReleaseAt: null, contributorsCount: null },
      NOW,
    );
    expect(unknown.signals[0]).toEqual({ signal: 'staleness', value: 'unknown', points: 0 });
    expect(unknown.maintenanceScore).toBe(0);
  });

  it('falls back to text matching and reports an unrecognised license', () => {
    expect(
      detectLicense({
        ...base,
        licenseSpdxId: 'NOASSERTION',
        licenseFileText: 'Permission is hereby granted, free of charge',
      }),
    ).toEqual({ spdxId: 'MIT', method: 'text-match', permissive: true });
    expect(
      detectLicense({
        ...base,
        licenseSpdxId: null,
        licenseFileText: 'GNU AFFERO GENERAL PUBLIC LICENSE',
      }),
    ).toEqual({ spdxId: 'AGPL-3.0', method: 'text-match', permissive: false });
    expect(
      detectLicense({ ...base, licenseSpdxId: null, licenseFileText: 'custom terms' }),
    ).toEqual({
      spdxId: null,
      method: 'none',
      permissive: null,
    });
    expect(detectLicense({ ...base, licenseSpdxId: null, licenseFileText: null }).method).toBe(
      'none',
    );
  });

  it('handles an unparsable pushed_at date', () => {
    expect(scoreMaintenance({ ...base, pushedAt: 'not-a-date' }, NOW).signals[0]?.points).toBe(0);
  });
});
