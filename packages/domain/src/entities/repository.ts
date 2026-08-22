/**
 * RepositoryData — payload of the `repository` node (11_GITHUB.md §4.1).
 *
 * Everything here is an observation of the GitHub API, so the schema is deliberately close to the
 * API shape; the mapping from raw JSON lives in `packages/integrations/github` (N5: no fetching in
 * domain). `fetch` carries the conditional-request state §4.4 needs to refresh without spending
 * rate-limit quota.
 */
import { z } from 'zod';

export const RepositoryFetchSchema = z.object({
  etag: z.string().nullable(),
  lastFetchedAt: z.string(),
  lastStatus: z.enum(['ok', 'not_modified', 'rate_limited', 'not_found', 'forbidden', 'error']),
  authMode: z.enum(['anonymous', 'user', 'app', 'service']),
  staleSince: z.string().nullable(),
});

export const RepositoryDataSchema = z.object({
  provider: z.literal('github'),
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  key: z.string(),
  htmlUrl: z.string().url(),
  apiUrl: z.string().url(),
  description: z.string().nullable(),
  homepage: z.string().nullable(),
  defaultBranch: z.string(),
  pinnedRef: z.string().nullable(),
  visibility: z.enum(['public', 'private', 'internal']),
  isFork: z.boolean(),
  parentFullName: z.string().nullable(),
  isArchived: z.boolean(),
  isTemplate: z.boolean(),
  stars: z.number().int(),
  forks: z.number().int(),
  watchers: z.number().int(),
  /** GitHub counts pull requests in this number; the Issues tab computes `openIssuesOnly` (§4.4). */
  openIssues: z.number().int(),
  openIssuesOnly: z.number().int().nullable(),
  size: z.number().int(),
  license: z
    .object({ spdxId: z.string().nullable(), name: z.string(), url: z.string().nullable() })
    .nullable(),
  languages: z.array(z.object({ name: z.string(), bytes: z.number().int(), pct: z.number() })),
  primaryLanguage: z.string().nullable(),
  topics: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  pushedAt: z.string(),
  latestRelease: z
    .object({
      tag: z.string(),
      name: z.string().nullable(),
      publishedAt: z.string(),
      prerelease: z.boolean(),
      url: z.string(),
    })
    .nullable(),
  readme: z
    .object({
      path: z.string(),
      sha: z.string(),
      markdown: z.string(),
      renderedHtmlKey: z.string().nullable(),
      truncated: z.boolean(),
    })
    .nullable(),
  manifests: z.array(
    z.object({
      ecosystem: z.enum([
        'npm',
        'pip',
        'go',
        'cargo',
        'maven',
        'gradle',
        'composer',
        'gem',
        'nuget',
        'other',
      ]),
      path: z.string(),
      sha: z.string(),
    }),
  ),
  analysisId: z.string().nullable(),
  fetch: RepositoryFetchSchema,
});

export type RepositoryFetchState = z.infer<typeof RepositoryFetchSchema>;
export type RepositoryData = z.infer<typeof RepositoryDataSchema>;

/** §4.1: README markdown is stored inline in the node payload, capped. */
export const README_MAX_BYTES = 262_144;
