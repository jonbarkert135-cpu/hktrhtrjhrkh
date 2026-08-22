/**
 * Steps A/B/D/I — the only network part of the Repository Analysis Agent (11_GITHUB.md §5.1).
 *
 * It gathers plain data and hands it to `analyzeRepository`, which stays pure. Every step is
 * budget-guarded: running out of requests never fails the analysis, it appends to `skippedSteps`
 * and the result is emitted with `completeness < 1` (§5.9).
 */

import { BudgetExhausted, type GithubClient } from '../client.ts';
import { TREE_NODE_BUDGET } from './tree.ts';
import type { AnalysisInputs } from './analyze.ts';

/** §5.4's priority order; matched against the tree, so we only fetch files that exist. */
const KEYFILE_PATTERNS: readonly RegExp[] = [
  /^package\.json$/,
  /^pyproject\.toml$/,
  /^setup\.py$/,
  /^requirements[^/]*\.txt$/,
  /^go\.mod$/,
  /^Cargo\.toml$/,
  /^Gemfile$/,
  /^composer\.json$/,
  /^Dockerfile$/,
  /^docker-compose\.ya?ml$/,
  /^Makefile$/,
  /^Taskfile\.ya?ml$/,
  /^justfile$/,
  /^\.github\/workflows\/[^/]+\.ya?ml$/,
];

export const KEYFILE_BUDGET = 10;
export const KEYFILE_MAX_BYTES = 262_144;

export interface RepoMeta {
  readonly full_name?: string;
  readonly default_branch?: string;
  readonly pushed_at?: string | null;
  readonly archived?: boolean;
  readonly stargazers_count?: number;
  readonly open_issues_count?: number;
  readonly license?: { readonly spdx_id?: string | null } | null;
}

interface Tree {
  readonly sha?: string;
  readonly truncated?: boolean;
  readonly tree?: readonly { readonly path?: string; readonly type?: string }[];
}

export interface CollectOptions {
  /** Deterministic clock supplied by the job, never read inside the pipeline. */
  readonly nowMs: number;
  /** README fetched by node hydration; §5.4 item 5 says reuse it, do not refetch. */
  readonly readme?: string | null;
}

/** Selects the key files present in the tree, in §5.4's priority order, capped at the budget. */
export function selectKeyFiles(paths: readonly string[]): string[] {
  const selected: string[] = [];
  for (const pattern of KEYFILE_PATTERNS) {
    for (const path of paths) {
      if (selected.length >= KEYFILE_BUDGET) return selected;
      if (pattern.test(path) && !selected.includes(path)) selected.push(path);
    }
  }
  return selected;
}

export async function collectAnalysisInputs(
  client: GithubClient,
  repoKey: string,
  options: CollectOptions,
): Promise<AnalysisInputs> {
  const skipped: string[] = [];
  // Step J is never run by the deterministic collector; the LLM pass is a separate job (§5.11).
  const skippedAtEnd = ['llm'];

  const repo = await client.json<RepoMeta>(`/repos/${repoKey}`);
  if (repo === null) throw new BudgetExhausted('cap');

  const branch = repo.default_branch ?? 'main';
  const tree = await optional(
    () => client.json<Tree>(`/repos/${repoKey}/git/trees/${branch}?recursive=1`),
    skipped,
    'tree',
  );
  const treePaths = (tree?.tree ?? [])
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => entry.path as string)
    .slice(0, TREE_NODE_BUDGET);
  const headSha = tree?.sha ?? branch;

  const languagesApi =
    (await optional(
      () => client.json<Record<string, number>>(`/repos/${repoKey}/languages`),
      skipped,
      'classify',
    )) ?? {};

  const files = new Map<string, string>();
  let keyfileSkipped = false;
  for (const path of selectKeyFiles(treePaths)) {
    const content = await optional(
      () => client.raw(repoKey, headSha, path, KEYFILE_MAX_BYTES),
      [],
      'keyfiles',
      () => {
        keyfileSkipped = true;
      },
    );
    if (keyfileSkipped) break;
    if (content !== null && content !== undefined) files.set(path, content);
  }
  if (keyfileSkipped) skipped.push('keyfiles');

  const release = await optional(
    () => client.json<{ published_at?: string | null }>(`/repos/${repoKey}/releases/latest`),
    skipped,
    'health',
  );
  const contributors = await optional(
    () => client.json<readonly unknown[]>(`/repos/${repoKey}/contributors?per_page=30&anon=0`),
    [],
    'health',
  );

  return {
    repoKey: repo.full_name ?? repoKey,
    headSha,
    treePaths,
    treeComplete: tree?.truncated !== true,
    languagesApi,
    files,
    readme: options.readme ?? null,
    health: {
      pushedAt: repo.pushed_at ?? null,
      latestReleaseAt: release?.published_at ?? null,
      archived: repo.archived === true,
      stars: repo.stargazers_count ?? 0,
      openIssues: repo.open_issues_count ?? 0,
      contributorsCount: contributors?.length ?? null,
      licenseSpdxId: repo.license?.spdx_id ?? null,
      licenseFileText: files.get('LICENSE') ?? null,
    },
    skippedSteps: [...new Set([...skipped, ...skippedAtEnd])],
    producedAt: new Date(options.nowMs).toISOString(),
    nowMs: options.nowMs,
  };
}

/**
 * Runs one budget-guarded step. A budget stop is recorded, never thrown: §5.9 requires a partial
 * analysis. Real GitHub errors (auth, throttling) still propagate — those are not "less data".
 */
async function optional<T>(
  step: () => Promise<T | null>,
  skipped: string[],
  name: string,
  onSkip?: () => void,
): Promise<T | null | undefined> {
  try {
    return await step();
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    if (!skipped.includes(name)) skipped.push(name);
    onSkip?.();
    return undefined;
  }
}
