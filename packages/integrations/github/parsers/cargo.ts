/** `Cargo.toml` parser (11_GITHUB.md §5.5). `[[bin]]` and `[lib]` feed steps F/G. */
import { asArray, asString, asTable, parseToml, type TomlValue } from './toml.ts';
import {
  basename,
  capDependencies,
  emptyManifest,
  type Dependency,
  type DependencyParser,
  type ParsedManifest,
  type Scope,
} from './types.ts';

const TABLES: ReadonlyArray<[string, Scope]> = [
  ['dependencies', 'runtime'],
  ['dev-dependencies', 'dev'],
  ['build-dependencies', 'build'],
];

/** A cargo dependency is either `name = "1.0"` or `name = { version = "1.0", … }`. */
const range = (value: TomlValue): string | null =>
  typeof value === 'string' ? value : asString(asTable(value)?.['version']);

export const cargoParser: DependencyParser = {
  ecosystem: 'cargo',
  matches: (path) => basename(path) === 'Cargo.toml',
  parse(path, content): ParsedManifest {
    let root;
    try {
      root = parseToml(content);
    } catch {
      return emptyManifest('cargo', path, ['could not parse Cargo.toml']);
    }
    const pkg = asTable(root['package']);
    const dependencies: Dependency[] = [];
    for (const [table, scope] of TABLES) {
      for (const [name, value] of Object.entries(asTable(root[table]) ?? {})) {
        dependencies.push({
          name,
          range: range(value),
          scope,
          ecosystem: 'cargo',
          registryUrl: `https://crates.io/crates/${name}`,
          repoUrlGuess: null,
        });
      }
    }
    const bins = asArray(root['bin'])
      .map((entry) => asString(asTable(entry)?.['name']))
      .filter((name): name is string => name !== null);

    return {
      ecosystem: 'cargo',
      path,
      packageName: asString(pkg?.['name']),
      version: asString(pkg?.['version']),
      ...capDependencies(dependencies),
      errors: [],
      extras: {
        bins,
        hasLibraryEntry: asTable(root['lib']) !== null,
        workspaceMembers: asArray(asTable(root['workspace'])?.['members']).filter(
          (member): member is string => typeof member === 'string',
        ),
      },
    };
  },
};
