/**
 * Repository Analysis Agent — deterministic core (11_GITHUB.md §5).
 *
 * Steps A/B/D do the network; this module is the pure part: given the fetched inputs it produces a
 * `RepositoryAnalysis` with no I/O, no clock and no randomness, so the same inputs always yield a
 * byte-identical result and `inputsDigest` is a real cache key (§5.1, §5.12).
 */
import { ANALYZER_VERSION, sha256Hex, type RepositoryAnalysis } from '@nexus/domain';
import { parseManifests } from '../parsers/index.ts';
import { imageHints, parseDockerfile } from './container.ts';
import { detectEntryPoints } from './entrypoints.ts';
import { scoreMaintenance, type HealthInput } from './health.ts';
import { detectLanguages, primaryLanguage } from './languages.ts';
import { classifyLayout, filterTree } from './tree.ts';
import { detectSurface } from './surface.ts';

/** Everything the fetch steps collected. Deliberately plain data — easy to record as a fixture. */
export interface AnalysisInputs {
  repoKey: string;
  headSha: string;
  treePaths: readonly string[];
  treeComplete: boolean;
  languagesApi: Record<string, number>;
  /** Key files by repo-relative path, already size-capped by the fetcher. */
  files: ReadonlyMap<string, string>;
  readme: string | null;
  health: HealthInput;
  /** Steps the budget forced us to skip (§5.9). */
  skippedSteps?: readonly string[];
  /** Deterministic timestamp supplied by the caller — never `Date.now()` inside the pipeline. */
  producedAt: string;
  nowMs: number;
}

/** §5.1: all ten pipeline steps, used to turn `skippedSteps` into a completeness ratio. */
const STEPS = [
  'resolve',
  'tree',
  'classify',
  'keyfiles',
  'deps',
  'entrypoints',
  'surface',
  'container',
  'health',
  'llm',
];

const TOP_DEPENDENCIES = 10;

function digest(inputs: AnalysisInputs): string {
  const parts = [inputs.headSha, ANALYZER_VERSION, ...[...inputs.files.keys()].sort()];
  return sha256Hex(new TextEncoder().encode(parts.join('\n')));
}

export function analyzeRepository(inputs: AnalysisInputs): RepositoryAnalysis {
  const treePaths = filterTree(inputs.treePaths);
  const manifests = parseManifests(inputs.files);
  const languages = detectLanguages(inputs.languagesApi, treePaths);
  const { entryPoints, commands, systems, runtimeVersions } = detectEntryPoints(
    manifests,
    treePaths,
    inputs.files,
  );

  const dockerfileContent = inputs.files.get('Dockerfile');
  const composePaths = [...inputs.files.keys()].filter((path) =>
    /^docker-compose\.ya?ml$/.test(path),
  );
  // `parseDockerfile` also returns the run command, which belongs to the entry points, not here.
  const { command: _dockerCommand, ...container } = dockerfileContent
    ? parseDockerfile('Dockerfile', dockerfileContent)
    : {
        command: null,
        dockerfile: null,
        compose: [] as string[],
        baseImages: [] as string[],
        exposedPorts: [] as number[],
        publishedImageHints: [] as string[],
        rootUser: null as boolean | null,
      };
  const hints = new Set<string>();
  for (const path of composePaths) {
    for (const hint of imageHints(inputs.files.get(path) ?? '')) hints.add(hint);
  }
  if (inputs.readme) for (const hint of imageHints(inputs.readme)) hints.add(hint);

  const skippedSteps = [...(inputs.skippedSteps ?? [])];

  return {
    repoKey: inputs.repoKey,
    headSha: inputs.headSha,
    inputsDigest: digest(inputs),
    analyzerVersion: ANALYZER_VERSION,
    producedAt: inputs.producedAt,
    completeness: Number(
      Math.max(0, (STEPS.length - skippedSteps.length) / STEPS.length).toFixed(2),
    ),
    skippedSteps,
    treeComplete: inputs.treeComplete,

    languages,
    primaryLanguage: primaryLanguage(languages),
    layout: classifyLayout(treePaths, manifests),
    entryPoints,
    build: { systems, commands, runtimeVersions },
    dependencies: manifests.map((manifest) => ({
      ecosystem: manifest.ecosystem,
      path: manifest.path,
      packageName: manifest.packageName,
      direct: manifest.dependencies.filter((dep) => dep.scope === 'runtime').length,
      dev: manifest.dependencies.filter((dep) => dep.scope === 'dev').length,
      truncated: manifest.truncatedDependencies,
      top: manifest.dependencies
        .slice(0, TOP_DEPENDENCIES)
        .map((dep) => ({ name: dep.name, range: dep.range, scope: dep.scope })),
      parseErrors: manifest.errors,
    })),
    surface: detectSurface(entryPoints, manifests, inputs.files, treePaths, inputs.readme),
    container: {
      ...container,
      compose: composePaths,
      publishedImageHints: [...hints],
    },
    health: scoreMaintenance(inputs.health, inputs.nowMs),
    // Step J is the LLM pass; the deterministic core leaves it empty by construction (§5.11).
    narrative: {
      summary: null,
      architecture: null,
      integrationNotes: null,
      model: null,
      generatedAt: null,
    },
  };
}
