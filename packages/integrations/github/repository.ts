/**
 * GitHub REST repository payload → `RepositoryData` (11_GITHUB.md §4.1).
 *
 * Pure and total: every field the API may omit gets the schema's documented fallback, so a sparse
 * or unusual repository still produces a valid node instead of a validation failure mid-hydration.
 */

import { RepositoryDataSchema, type RepositoryData } from '@nexus/domain';

/** Only the fields we read; the API sends far more and we deliberately drop it. */
export interface RepoApi {
  readonly name?: string;
  readonly full_name?: string;
  readonly html_url?: string;
  readonly url?: string;
  readonly owner?: { readonly login?: string } | null;
  readonly description?: string | null;
  readonly homepage?: string | null;
  readonly default_branch?: string;
  readonly visibility?: string;
  readonly private?: boolean;
  readonly fork?: boolean;
  readonly parent?: { readonly full_name?: string } | null;
  readonly archived?: boolean;
  readonly is_template?: boolean;
  readonly stargazers_count?: number;
  readonly forks_count?: number;
  readonly subscribers_count?: number;
  readonly open_issues_count?: number;
  readonly size?: number;
  readonly license?: {
    readonly spdx_id?: string | null;
    readonly name?: string;
    readonly url?: string | null;
  } | null;
  readonly topics?: readonly string[];
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly pushed_at?: string;
}

export interface MapRepositoryOptions {
  /** `githubRefKey` of the pasted ref — the dedupe identity (§7.2). */
  readonly key: string;
  /** `GET /repos/{key}/languages`: bytes per language. */
  readonly languages?: Readonly<Record<string, number>>;
  readonly pinnedRef?: string | null;
  readonly fetchedAt: string;
  readonly etag?: string | null;
  readonly authMode?: RepositoryData['fetch']['authMode'];
}

function languageStats(bytes: Readonly<Record<string, number>>): RepositoryData['languages'] {
  const total = Object.values(bytes).reduce((sum, n) => sum + n, 0);
  return Object.entries(bytes)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, bytes: n, pct: total === 0 ? 0 : (n / total) * 100 }));
}

function visibilityOf(api: RepoApi): RepositoryData['visibility'] {
  if (api.visibility === 'internal') return 'internal';
  return api.visibility === 'private' || api.private === true ? 'private' : 'public';
}

export function mapRepository(api: RepoApi, options: MapRepositoryOptions): RepositoryData {
  const fullName = api.full_name ?? '';
  const [ownerFromFull = '', nameFromFull = ''] = fullName.split('/');
  const owner = api.owner?.login ?? ownerFromFull;
  const name = api.name ?? nameFromFull;
  const languages = languageStats(options.languages ?? {});

  return RepositoryDataSchema.parse({
    provider: 'github',
    owner,
    name,
    fullName: fullName === '' ? `${owner}/${name}` : fullName,
    key: options.key,
    htmlUrl: api.html_url ?? `https://github.com/${owner}/${name}`,
    apiUrl: api.url ?? `https://api.github.com/repos/${owner}/${name}`,
    description: api.description ?? null,
    homepage: api.homepage === '' ? null : (api.homepage ?? null),
    defaultBranch: api.default_branch ?? 'main',
    pinnedRef: options.pinnedRef ?? null,
    visibility: visibilityOf(api),
    isFork: api.fork === true,
    parentFullName: api.parent?.full_name ?? null,
    isArchived: api.archived === true,
    isTemplate: api.is_template === true,
    stars: api.stargazers_count ?? 0,
    forks: api.forks_count ?? 0,
    watchers: api.subscribers_count ?? 0,
    openIssues: api.open_issues_count ?? 0,
    // Computed once per TTL by the Issues tab, which is the only place that can subtract PRs (§4.4).
    openIssuesOnly: null,
    size: api.size ?? 0,
    license:
      api.license === null || api.license === undefined
        ? null
        : {
            spdxId: api.license.spdx_id ?? null,
            name: api.license.name ?? '',
            url: api.license.url ?? null,
          },
    languages,
    primaryLanguage: languages[0]?.name ?? null,
    topics: [...(api.topics ?? [])],
    createdAt: api.created_at ?? options.fetchedAt,
    updatedAt: api.updated_at ?? options.fetchedAt,
    pushedAt: api.pushed_at ?? options.fetchedAt,
    // Filled by their own tabs/jobs; hydration stays one or two requests (§3.5).
    latestRelease: null,
    readme: null,
    manifests: [],
    analysisId: null,
    fetch: {
      etag: options.etag ?? null,
      lastFetchedAt: options.fetchedAt,
      lastStatus: 'ok',
      authMode: options.authMode ?? 'anonymous',
      staleSince: null,
    },
  });
}
