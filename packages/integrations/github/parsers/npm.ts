/** npm manifest parser (11_GITHUB.md §5.5). `bin`/`scripts` feed steps F/G. */
import {
  capDependencies,
  emptyManifest,
  basename,
  type Dependency,
  type DependencyParser,
  type ParsedManifest,
  type Scope,
} from './types.ts';

const SCOPES: ReadonlyArray<[string, Scope]> = [
  ['dependencies', 'runtime'],
  ['devDependencies', 'dev'],
  ['peerDependencies', 'peer'],
  ['optionalDependencies', 'optional'],
];

const registryUrl = (name: string): string => `https://www.npmjs.com/package/${name}`;

const stringRecord = (value: unknown): Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
};

const repositoryUrl = (repository: unknown): string | null => {
  if (typeof repository === 'string') return repository;
  if (typeof repository === 'object' && repository !== null) {
    const url = (repository as { url?: unknown }).url;
    if (typeof url === 'string') return url;
  }
  return null;
};

export const npmParser: DependencyParser = {
  ecosystem: 'npm',
  matches: (path) => basename(path) === 'package.json',
  parse(path, content): ParsedManifest {
    let json: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return emptyManifest('npm', path, ['package.json is not an object']);
      }
      json = parsed as Record<string, unknown>;
    } catch {
      return emptyManifest('npm', path, ['package.json is not valid JSON']);
    }

    const repoUrlGuess = repositoryUrl(json['repository']);
    const dependencies: Dependency[] = [];
    for (const [field, scope] of SCOPES) {
      for (const [name, range] of Object.entries(stringRecord(json[field]))) {
        dependencies.push({
          name,
          range,
          scope,
          ecosystem: 'npm',
          registryUrl: registryUrl(name),
          repoUrlGuess: null,
        });
      }
    }

    const bin = json['bin'];
    const binNames =
      typeof bin === 'string'
        ? [typeof json['name'] === 'string' ? json['name'] : basename(bin)]
        : Object.keys(stringRecord(bin));

    return {
      ecosystem: 'npm',
      path,
      packageName: typeof json['name'] === 'string' ? json['name'] : null,
      version: typeof json['version'] === 'string' ? json['version'] : null,
      ...capDependencies(dependencies),
      errors: [],
      extras: {
        bin: binNames,
        scripts: stringRecord(json['scripts']),
        engines: stringRecord(json['engines']),
        hasLibraryEntry:
          typeof json['main'] === 'string' ||
          typeof json['module'] === 'string' ||
          json['exports'] !== undefined,
        repoUrlGuess,
        workspaces: Array.isArray(json['workspaces'])
          ? (json['workspaces'] as unknown[]).filter((w): w is string => typeof w === 'string')
          : [],
      },
    };
  },
};
