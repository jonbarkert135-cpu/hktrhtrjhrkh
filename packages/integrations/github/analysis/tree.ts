/** Step B/C helpers — tree filtering and layout classification (11_GITHUB.md §5.2, §5.10). */
import type { ParsedManifest } from '../parsers/index.ts';

/** Directories that never say anything about the project itself (§5.2). */
const IGNORED_DIRS = ['node_modules', 'vendor', 'dist', 'build', '.venv', 'target', '.git'];
const MAX_DEPTH = 12;
export const TREE_NODE_BUDGET = 4000;

export function filterTree(paths: readonly string[]): string[] {
  return paths.filter((path) => {
    const segments = path.split('/');
    if (segments.length > MAX_DEPTH) return false;
    return !segments.some((segment) => IGNORED_DIRS.includes(segment));
  });
}

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '.' : path.slice(0, slash);
};

export interface Layout {
  kind: 'single-package' | 'monorepo' | 'multi-module' | 'unknown';
  packages: { path: string; ecosystem: string; name: string | null }[];
  docsDirs: string[];
  testDirs: string[];
  ciProviders: string[];
}

export function classifyLayout(
  paths: readonly string[],
  manifests: readonly ParsedManifest[],
): Layout {
  const packages = manifests.map((manifest) => ({
    path: dirOf(manifest.path),
    ecosystem: manifest.ecosystem,
    name: manifest.packageName,
  }));
  const topLevelDirs = new Set(
    paths.map((path) => path.split('/')[0] ?? '').filter((dir) => dir !== ''),
  );
  const docsDirs = ['docs', 'doc', 'documentation'].filter((dir) => topLevelDirs.has(dir));
  const testDirs = ['tests', 'test', 'spec', '__tests__'].filter((dir) => topLevelDirs.has(dir));

  const ciProviders: string[] = [];
  if (paths.some((path) => path.startsWith('.github/workflows/')))
    ciProviders.push('github-actions');
  if (paths.includes('.gitlab-ci.yml')) ciProviders.push('gitlab-ci');
  if (paths.some((path) => path.startsWith('.circleci/'))) ciProviders.push('circleci');

  const nested = packages.filter((pkg) => pkg.path !== '.');
  const ecosystems = new Set(packages.map((pkg) => pkg.ecosystem));
  const kind: Layout['kind'] =
    packages.length === 0
      ? 'unknown'
      : nested.length >= 2
        ? ecosystems.size > 1
          ? 'multi-module'
          : 'monorepo'
        : 'single-package';

  return { kind, packages, docsDirs, testDirs, ciProviders };
}
