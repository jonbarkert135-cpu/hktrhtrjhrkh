/**
 * Python manifest parser (11_GITHUB.md §5.5): PEP 621 + poetry from `pyproject.toml`,
 * `requirements*.txt`, and a regex-restricted `setup.py` reader (literal `install_requires` lists
 * only — anything computed is reported as `setup.py dynamic`, never guessed).
 */
import { asArray, asString, asTable, parseToml } from './toml.ts';
import {
  basename,
  capDependencies,
  emptyManifest,
  type Dependency,
  type DependencyParser,
  type ParsedManifest,
  type Scope,
} from './types.ts';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*/;

const registryUrl = (name: string): string => `https://pypi.org/project/${name}/`;

/** Splits a PEP 508 requirement into name and the rest (the version range as written). */
function requirement(spec: string, scope: Scope): Dependency | null {
  const text = spec.split(';')[0]?.trim() ?? '';
  const name = NAME_RE.exec(text)?.[0];
  if (!name) return null;
  const range = text
    .slice(name.length)
    .trim()
    .replace(/^\[.*?\]/, '')
    .trim();
  return {
    name,
    range: range === '' ? null : range,
    scope,
    ecosystem: 'pip',
    registryUrl: registryUrl(name),
    repoUrlGuess: null,
  };
}

function fromPyproject(path: string, content: string): ParsedManifest {
  const root = parseToml(content);
  const project = asTable(root['project']);
  const poetry = asTable(asTable(asTable(root['tool'])?.['poetry'] ?? undefined) ?? undefined);
  const dependencies: Dependency[] = [];
  const errors: string[] = [];

  for (const entry of asArray(project?.['dependencies'])) {
    const dep = typeof entry === 'string' ? requirement(entry, 'runtime') : null;
    if (dep) dependencies.push(dep);
  }
  const optional = asTable(project?.['optional-dependencies']);
  for (const group of Object.values(optional ?? {})) {
    for (const entry of asArray(group)) {
      const dep = typeof entry === 'string' ? requirement(entry, 'optional') : null;
      if (dep) dependencies.push(dep);
    }
  }
  const poetryDeps = asTable(poetry?.['dependencies']);
  for (const [name, value] of Object.entries(poetryDeps ?? {})) {
    if (name === 'python') continue;
    dependencies.push({
      name,
      range: typeof value === 'string' ? value : null,
      scope: 'runtime',
      ecosystem: 'pip',
      registryUrl: registryUrl(name),
      repoUrlGuess: null,
    });
  }

  const scripts = {
    ...(asTable(project?.['scripts']) ?? {}),
    ...(asTable(poetry?.['scripts']) ?? {}),
  };
  const requiresPython = asString(project?.['requires-python']) ?? asString(poetryDeps?.['python']);

  return {
    ecosystem: 'pip',
    path,
    packageName: asString(project?.['name']) ?? asString(poetry?.['name']),
    version: asString(project?.['version']) ?? asString(poetry?.['version']),
    ...capDependencies(dependencies),
    errors,
    extras: {
      consoleScripts: Object.keys(scripts),
      requiresPython,
      hasLibraryEntry: project !== null || poetry !== null,
      buildBackend: asString(asTable(root['build-system'])?.['build-backend']),
    },
  };
}

function fromRequirements(path: string, content: string): ParsedManifest {
  const dependencies: Dependency[] = [];
  const errors: string[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim();
    if (line === '') continue;
    if (line.startsWith('-')) {
      // -r other.txt / -e . / --index-url: references we deliberately do not follow.
      continue;
    }
    const dep = requirement(line, 'runtime');
    if (dep) dependencies.push(dep);
    else errors.push(`unparsed requirement: ${line.slice(0, 80)}`);
  }
  return {
    ecosystem: 'pip',
    path,
    packageName: null,
    version: null,
    ...capDependencies(dependencies),
    errors,
    extras: {},
  };
}

function fromSetupPy(path: string, content: string): ParsedManifest {
  const list = /install_requires\s*=\s*\[([^\]]*)\]/s.exec(content)?.[1];
  if (list === undefined) return emptyManifest('pip', path, ['setup.py dynamic']);
  const dependencies: Dependency[] = [];
  let dynamic = false;
  for (const raw of list.split(',')) {
    const item = raw.trim();
    if (item === '') continue;
    if (!/^["'][^"']*["']$/.test(item)) {
      dynamic = true;
      continue;
    }
    const dep = requirement(item.slice(1, -1), 'runtime');
    if (dep) dependencies.push(dep);
  }
  const name = /name\s*=\s*["']([^"']+)["']/.exec(content)?.[1] ?? null;
  return {
    ecosystem: 'pip',
    path,
    packageName: name,
    version: /version\s*=\s*["']([^"']+)["']/.exec(content)?.[1] ?? null,
    ...capDependencies(dependencies),
    errors: dynamic ? ['setup.py dynamic'] : [],
    extras: { hasLibraryEntry: true },
  };
}

export const pipParser: DependencyParser = {
  ecosystem: 'pip',
  matches(path) {
    const file = basename(path);
    return file === 'pyproject.toml' || file === 'setup.py' || /^requirements.*\.txt$/.test(file);
  },
  parse(path, content): ParsedManifest {
    const file = basename(path);
    try {
      if (file === 'pyproject.toml') return fromPyproject(path, content);
      if (file === 'setup.py') return fromSetupPy(path, content);
      return fromRequirements(path, content);
    } catch {
      return emptyManifest('pip', path, [`could not parse ${file}`]);
    }
  },
};
