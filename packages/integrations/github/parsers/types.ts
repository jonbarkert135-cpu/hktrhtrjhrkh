/** Dependency parser contract (11_GITHUB.md §5.5). Parsers are pure and must never throw. */

export type Ecosystem = 'npm' | 'pip' | 'go' | 'cargo';

export type Scope = 'runtime' | 'dev' | 'peer' | 'optional' | 'build' | 'test';

export interface Dependency {
  name: string;
  /** As written in the manifest — never resolved. */
  range: string | null;
  scope: Scope;
  ecosystem: Ecosystem;
  registryUrl: string | null;
  /** Only when the manifest itself states a repository URL. */
  repoUrlGuess: string | null;
}

export interface ParsedManifest {
  ecosystem: Ecosystem;
  path: string;
  packageName: string | null;
  version: string | null;
  dependencies: Dependency[];
  truncatedDependencies: number;
  errors: string[];
  /** Extra facts steps F/G need (npm scripts/bin, python console scripts, cargo bins…). */
  extras: Record<string, unknown>;
}

export interface DependencyParser {
  ecosystem: Ecosystem;
  matches(path: string): boolean;
  parse(path: string, content: string): ParsedManifest;
}

/** §5.5: at most 500 dependencies per manifest, the rest is only counted. */
export const MAX_DEPENDENCIES = 500;

export function capDependencies(deps: Dependency[]): {
  dependencies: Dependency[];
  truncatedDependencies: number;
} {
  if (deps.length <= MAX_DEPENDENCIES) return { dependencies: deps, truncatedDependencies: 0 };
  return {
    dependencies: deps.slice(0, MAX_DEPENDENCIES),
    truncatedDependencies: deps.length - MAX_DEPENDENCIES,
  };
}

export function emptyManifest(
  ecosystem: Ecosystem,
  path: string,
  errors: string[],
): ParsedManifest {
  return {
    ecosystem,
    path,
    packageName: null,
    version: null,
    dependencies: [],
    truncatedDependencies: 0,
    errors,
    extras: {},
  };
}

/** File name of a path, without directories. */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
