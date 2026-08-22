/** Dependency parsers (11_GITHUB.md §5.5): exact extraction, never a guessed dependency. */

import { describe, expect, it } from 'vitest';

import { parseToml } from '../github/parsers/toml.ts';
import {
  cargoParser,
  goParser,
  npmParser,
  parseManifests,
  parserFor,
  pipParser,
} from '../github/parsers/index.ts';
import { MAX_DEPENDENCIES, capDependencies, type Dependency } from '../github/parsers/types.ts';

describe('parseToml', () => {
  it('reads tables, arrays of tables, inline tables and multi-line arrays', () => {
    const parsed = parseToml(`
# comment
[package]
name = "demo"
version = "0.1.0"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
anyhow = "1"

[[bin]]
name = "cli"

[[bin]]
name = "worker"

[project]
deps = [
  "a",
  "b",
]
`);
    expect(parsed['package']).toEqual({ name: 'demo', version: '0.1.0' });
    expect(parsed['dependencies']).toEqual({
      serde: { version: '1.0', features: ['derive'] },
      anyhow: '1',
    });
    expect(parsed['bin']).toEqual([{ name: 'cli' }, { name: 'worker' }]);
    expect((parsed['project'] as { deps: string[] }).deps).toEqual(['a', 'b']);
  });

  it('parses booleans, numbers and dotted keys', () => {
    const parsed = parseToml('[a]\nb.c = true\nn = 3\nf = 1.5\n');
    expect(parsed['a']).toEqual({ b: { c: true }, n: 3, f: 1.5 });
  });
});

describe('npm parser', () => {
  const manifest = JSON.stringify({
    name: 'demo',
    version: '2.0.0',
    bin: { demo: 'cli.js' },
    main: 'index.js',
    engines: { node: '>=22' },
    scripts: { start: 'node index.js', build: 'tsc', unknown: 'x' },
    dependencies: { express: '^4.0.0' },
    devDependencies: { vitest: '^3' },
    peerDependencies: { react: '18' },
    optionalDependencies: { fsevents: '*' },
    repository: { url: 'https://github.com/demo/demo' },
    workspaces: ['packages/*'],
  });

  it('extracts scoped dependencies, bins and scripts', () => {
    const parsed = npmParser.parse('package.json', manifest);
    expect(parsed.packageName).toBe('demo');
    expect(parsed.version).toBe('2.0.0');
    expect(parsed.dependencies.map((d) => [d.name, d.scope])).toEqual([
      ['express', 'runtime'],
      ['vitest', 'dev'],
      ['react', 'peer'],
      ['fsevents', 'optional'],
    ]);
    expect(parsed.dependencies[0]?.registryUrl).toBe('https://www.npmjs.com/package/express');
    expect(parsed.extras['bin']).toEqual(['demo']);
    expect(parsed.extras['hasLibraryEntry']).toBe(true);
    expect(parsed.extras['repoUrlGuess']).toBe('https://github.com/demo/demo');
    expect(parsed.extras['workspaces']).toEqual(['packages/*']);
    expect(parsed.errors).toEqual([]);
  });

  it('reports invalid JSON instead of throwing', () => {
    expect(npmParser.parse('package.json', '{oops').errors).toEqual([
      'package.json is not valid JSON',
    ]);
    expect(npmParser.parse('package.json', '[]').errors).toEqual(['package.json is not an object']);
  });

  it('handles a string bin field', () => {
    const parsed = npmParser.parse('package.json', JSON.stringify({ name: 'tool', bin: 'x.js' }));
    expect(parsed.extras['bin']).toEqual(['tool']);
  });
});

describe('pip parser', () => {
  it('reads PEP 621 and optional dependencies', () => {
    const parsed = pipParser.parse(
      'pyproject.toml',
      `[project]
name = "sherlock-project"
version = "0.16.0"
requires-python = ">=3.9"
dependencies = ["requests >= 2.31", "colorama[extra] ~= 0.4"]

[project.optional-dependencies]
dev = ["pytest"]

[project.scripts]
sherlock = "sherlock_project:main"
`,
    );
    expect(parsed.packageName).toBe('sherlock-project');
    expect(parsed.dependencies).toEqual<Dependency[]>([
      {
        name: 'requests',
        range: '>= 2.31',
        scope: 'runtime',
        ecosystem: 'pip',
        registryUrl: 'https://pypi.org/project/requests/',
        repoUrlGuess: null,
      },
      {
        name: 'colorama',
        range: '~= 0.4',
        scope: 'runtime',
        ecosystem: 'pip',
        registryUrl: 'https://pypi.org/project/colorama/',
        repoUrlGuess: null,
      },
      {
        name: 'pytest',
        range: null,
        scope: 'optional',
        ecosystem: 'pip',
        registryUrl: 'https://pypi.org/project/pytest/',
        repoUrlGuess: null,
      },
    ]);
    expect(parsed.extras['consoleScripts']).toEqual(['sherlock']);
    expect(parsed.extras['requiresPython']).toBe('>=3.9');
  });

  it('reads poetry dependencies and skips the python pin', () => {
    const parsed = pipParser.parse(
      'pyproject.toml',
      `[tool.poetry]
name = "p"
version = "1.0"

[tool.poetry.dependencies]
python = "^3.11"
requests = "^2.31"
`,
    );
    expect(parsed.dependencies.map((d) => d.name)).toEqual(['requests']);
    expect(parsed.extras['requiresPython']).toBe('^3.11');
  });

  it('reads requirements.txt and reports unparsable lines', () => {
    const parsed = pipParser.parse('requirements.txt', '# c\nrequests==2.31\n-r other.txt\n???\n');
    expect(parsed.dependencies.map((d) => d.name)).toEqual(['requests']);
    expect(parsed.errors).toEqual(['unparsed requirement: ???']);
  });

  it('reads literal install_requires and flags dynamic setup.py', () => {
    const literal = pipParser.parse(
      'setup.py',
      'setup(name="demo", version="1.2", install_requires=["a>=1", "b"])',
    );
    expect(literal.dependencies.map((d) => d.name)).toEqual(['a', 'b']);
    expect(literal.packageName).toBe('demo');
    expect(literal.version).toBe('1.2');
    expect(pipParser.parse('setup.py', 'setup(install_requires=reqs)').errors).toEqual([
      'setup.py dynamic',
    ]);
    expect(pipParser.parse('setup.py', 'setup(install_requires=["a", VAR])').errors).toEqual([
      'setup.py dynamic',
    ]);
  });

  it('matches the file names from the spec', () => {
    expect(pipParser.matches('a/requirements-dev.txt')).toBe(true);
    expect(pipParser.matches('a/other.txt')).toBe(false);
  });
});

describe('go parser', () => {
  it('reads module, go version and both require forms', () => {
    const parsed = goParser.parse(
      'go.mod',
      `module github.com/demo/tool

go 1.22

require github.com/spf13/cobra v1.8.0

require (
	github.com/gin-gonic/gin v1.9.1
	golang.org/x/sys v0.1.0 // indirect
)
`,
    );
    expect(parsed.packageName).toBe('github.com/demo/tool');
    expect(parsed.extras['goVersion']).toBe('1.22');
    expect(parsed.dependencies.map((d) => [d.name, d.range, d.scope])).toEqual([
      ['github.com/spf13/cobra', 'v1.8.0', 'runtime'],
      ['github.com/gin-gonic/gin', 'v1.9.1', 'runtime'],
      ['golang.org/x/sys', 'v0.1.0', 'build'],
    ]);
  });
});

describe('cargo parser', () => {
  it('reads package, dependency tables and bins', () => {
    const parsed = cargoParser.parse(
      'Cargo.toml',
      `[package]
name = "demo"
version = "0.3.0"

[dependencies]
serde = { version = "1.0" }
anyhow = "1"

[dev-dependencies]
insta = "1.0"

[build-dependencies]
cc = "1"

[lib]
path = "src/lib.rs"

[[bin]]
name = "cli"

[workspace]
members = ["crates/a"]
`,
    );
    expect(parsed.packageName).toBe('demo');
    expect(parsed.dependencies.map((d) => [d.name, d.range, d.scope])).toEqual([
      ['serde', '1.0', 'runtime'],
      ['anyhow', '1', 'runtime'],
      ['insta', '1.0', 'dev'],
      ['cc', '1', 'build'],
    ]);
    expect(parsed.extras['bins']).toEqual(['cli']);
    expect(parsed.extras['hasLibraryEntry']).toBe(true);
    expect(parsed.extras['workspaceMembers']).toEqual(['crates/a']);
  });
});

describe('registry', () => {
  it('routes paths to parsers and ignores unknown files', () => {
    expect(parserFor('a/package.json')?.ecosystem).toBe('npm');
    expect(parserFor('README.md')).toBeNull();
    const parsed = parseManifests(
      new Map([
        ['package.json', '{"name":"a"}'],
        ['README.md', '# hi'],
      ]),
    );
    expect(parsed.map((m) => m.ecosystem)).toEqual(['npm']);
  });

  it('caps dependencies at the documented limit', () => {
    const many = Array.from({ length: MAX_DEPENDENCIES + 3 }, (_, i) => ({
      name: `p${i}`,
      range: null,
      scope: 'runtime' as const,
      ecosystem: 'npm' as const,
      registryUrl: null,
      repoUrlGuess: null,
    }));
    const capped = capDependencies(many);
    expect(capped.dependencies).toHaveLength(MAX_DEPENDENCIES);
    expect(capped.truncatedDependencies).toBe(3);
    expect(capDependencies(many.slice(0, 2)).truncatedDependencies).toBe(0);
  });
});
