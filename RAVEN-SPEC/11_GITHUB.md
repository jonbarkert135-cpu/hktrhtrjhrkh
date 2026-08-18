# Raven — 11 — GITHUB INTEGRATION & REPOSITORY ANALYSIS AGENT

## Scope

Defines the GitHub integration: authentication modes and token storage, URL detection and
canonicalization into node types, the `Repository` node and its sub-panels, the deterministic
Repository Analysis Agent (clone-less, API + raw file fetch) and its `RepositoryAnalysis` output,
the derived Integration Proposal, graph mapping/dedupe rules, and rate-limit/quota UX.
Ships in phase **P10** (`00_MASTER.md` §7) on top of the manifest-driven pipeline of
`10_INTEGRATIONS.md`. All graph writes go through a Proposal (N4). All outbound fetches are
SSRF-guarded (N7) and executed outside the API process (N5).

---

## 1. Position in the architecture

GitHub is **not** a special code path in the application core (`00_MASTER.md` §2, decision 3).
It is:

- a **manifest** at `packages/integrations/github/manifest.ts`,
- an **adapter** at `packages/integrations/github/adapter.ts` (API client, canonicalizer),
- **parsers** at `packages/integrations/github/parsers/*.ts`,
- an **analysis pipeline** at `packages/integrations/github/analysis/*.ts`,
- a **node mapper** at `packages/integrations/github/mapper.ts`,
- UI panels at `apps/web/src/features/github/*` that only render data from `packages/domain`.

The application core knows only: "a node of kind `repository` exists, an integration can refresh
it, an integration can propose more nodes". Removing the whole `github` folder must leave the app
compiling with GitHub nodes degrading to `link` nodes (`06_NODE_SYSTEM.md` §3, fallback kind).

Execution split:

| Work                                   | Where                                                   | Why                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| URL detection + canonicalization       | client (`packages/domain/url/github.ts`), pure function | must be instant on paste (`03_UX.md` paste pipeline)                                                                     |
| Metadata fetch, README fetch, analysis | `apps/worker` (BullMQ queue `github`)                   | needs secrets, rate-limit budget, retries                                                                                |
| Nothing                                | `apps/runner`                                           | GitHub is HTTP-only; no untrusted code executes, so the container sandbox is not required (contrast `13_SHERLOCK.md` §3) |
| LLM enrichment of analysis             | `apps/worker` → `AIProvider` (`14_AI_AGENT.md` §4)      | bounded, optional, never authoritative                                                                                   |

---

## 2. Authentication modes

Three modes, ordered by capability. The active mode is per **user per project**; an org may pin a
mode via project settings.

### 2.1 Mode A — Unauthenticated (default, zero-config)

- Uses `https://api.github.com` with no `Authorization` header.
- Documented GitHub behavior we rely on: unauthenticated requests are rate limited **per source
  IP** and the limit is far lower than authenticated. We do **not** hardcode the number. The
  adapter reads the limit from the response headers `x-ratelimit-limit`,
  `x-ratelimit-remaining`, `x-ratelimit-reset`, `x-ratelimit-used`, `x-ratelimit-resource`
  (capability probe, §2.5). If the headers are missing, the adapter assumes a budget of `60`
  requests/hour/instance and self-throttles to that — the conservative fallback.
- Available: public repo metadata, README, releases, contributors (first page), languages,
  topics, license, public issues/PRs, raw files from `raw.githubusercontent.com`.
- Not available: private repos, org membership, higher throughput, `GET /rate_limit` accuracy per
  user (the whole Raven instance shares one IP budget).
- Because the budget is shared, unauthenticated mode is **best-effort**: the Repository Analysis
  Agent is capped at `ANALYSIS_MAX_REQUESTS_UNAUTH = 12` requests per repository and skips
  optional steps (see §5.9).

### 2.2 Mode B — User OAuth (recommended for individuals)

Better-Auth (`00_MASTER.md` §2) already owns OAuth sessions; GitHub integration reuses the
provider but requests its **own** token with an explicit consent screen, stored separately from
the login identity (a user may log in with email and still connect GitHub).

Requested scopes, minimal-first:

| Tier                    | Scopes              | Grants                                                   |
| ----------------------- | ------------------- | -------------------------------------------------------- |
| `read-public` (default) | `read:user`         | authenticated rate budget, user identity for attribution |
| `read-private` (opt-in) | `read:user`, `repo` | private repository metadata and file reads               |
| `read-org` (opt-in)     | + `read:org`        | org membership, org repo listing                         |

Rules:

- We never request write scopes. The integration is read-only; the manifest declares
  `permissions: ['net:api.github.com', 'net:raw.githubusercontent.com']` and no write capability
  (`10_INTEGRATIONS.md` §4 permission model).
- Scope escalation is a separate, explicit re-consent; the UI states exactly which feature needs it
  ("Private repositories require the `repo` scope. Connect again with private access?").
- On revoke (`401` with `X-GitHub-...` or `Bad credentials`), the connection is marked
  `status: 'revoked'`, all queued GitHub jobs for that user fail fast with `AUTH_REVOKED`, and
  existing nodes keep their cached data (never deleted — N8).

### 2.3 Mode C — GitHub App (organizations, self-host)

- An operator registers a GitHub App and configures `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
  `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` in the instance secret store
  (`15_SECURITY.md` §5).
- Installation tokens are minted per installation, cached until `expires_at - 60s`, and scoped to
  the repositories the org granted.
- Permissions requested (read-only): `metadata: read`, `contents: read`, `issues: read`,
  `pull_requests: read`, `members: read` (org mode only).
- Benefit: a per-installation budget separate from any user, higher throughput, no personal token
  in the system, auditable at the org level.
- Selection rule at request time:

```ts
// packages/integrations/github/auth/select.ts
export function selectCredential(ctx: GithubRequestContext): GithubCredential {
  // 1. App installation covering the owner (private + org data, best budget)
  const inst = ctx.appInstallations.find((i) => i.owners.includes(ctx.owner));
  if (inst) return { kind: 'app', installationId: inst.id };
  // 2. The requesting user's OAuth token
  if (ctx.userToken && ctx.userToken.status === 'active')
    return { kind: 'user', userId: ctx.userId };
  // 3. Instance-wide service token (self-host operators may set GITHUB_SERVICE_TOKEN)
  if (ctx.serviceToken) return { kind: 'service' };
  // 4. Anonymous
  return { kind: 'anonymous' };
}
```

### 2.4 Token storage

```sql
-- packages/db/prisma/migrations/*_github.sql (expressed as SQL; Prisma models mirror it)
CREATE TABLE github_connection (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  org_id        uuid     REFERENCES org(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('user','app','service')),
  login         text,                    -- github login, for display
  scopes        text[] NOT NULL DEFAULT '{}',
  token_cipher  bytea,                   -- AES-256-GCM, key from KMS/env master key
  token_nonce   bytea,
  token_expires timestamptz,
  installation_id bigint,                -- kind='app'
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','revoked','expired','error')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  UNIQUE (user_id, kind, COALESCE(installation_id, 0))
);
CREATE INDEX github_connection_user_idx ON github_connection(user_id) WHERE status = 'active';
```

- Tokens are encrypted at rest with AES-256-GCM using the instance master key
  (`15_SECURITY.md` §5.2); the plaintext exists only in worker memory for the duration of a job.
- Tokens are **never** sent to the browser. The client sees `{ login, scopes, status, lastUsedAt }`.
- Audit: every decrypt writes an `audit_log` row `github.token.use` with `run_id` and purpose.

### 2.5 Capability probe

On connect and every 24 h, the adapter runs:

```
GET /rate_limit           -> budget shape, resources present
GET /user                 -> login, id (skipped when anonymous)
GET /meta                 -> api availability (cheap, unauthenticated-safe)
```

Result is stored as `GithubCapabilities`:

```ts
export interface GithubCapabilities {
  probedAt: string; // ISO
  apiBaseUrl: string; // https://api.github.com or GHE base
  authenticated: boolean;
  login: string | null;
  scopes: string[];
  rateLimitHeaders: boolean; // x-ratelimit-* present
  resources: string[]; // e.g. ['core','search','graphql'] as reported
  graphql: boolean; // POST /graphql returned 200 for `{viewer{login}}`
  ghesVersion: string | null; // from x-github-enterprise-version, if present
}
```

Everything not present in the probe result is treated as unavailable and the adapter uses the REST
fallback path. GraphQL is an **optimization only**: if `graphql === false`, all features still work
via REST with more requests (§5.9 request budget accounts for both).

---

## 3. URL detection and canonicalization

### 3.1 Contract

```ts
// packages/domain/url/github.ts
export type GithubRef =
  | { kind: 'repo'; owner: string; repo: string; ref?: string }
  | { kind: 'owner'; owner: string; ownerType: 'user' | 'org' | 'unknown' }
  | { kind: 'path'; owner: string; repo: string; ref: string; path: string; dir: boolean }
  | {
      kind: 'blobRange';
      owner: string;
      repo: string;
      ref: string;
      path: string;
      startLine: number;
      endLine: number | null;
    }
  | { kind: 'issue'; owner: string; repo: string; number: number }
  | { kind: 'pull'; owner: string; repo: string; number: number }
  | { kind: 'discussion'; owner: string; repo: string; number: number }
  | { kind: 'release'; owner: string; repo: string; tag: string | 'latest' }
  | { kind: 'commit'; owner: string; repo: string; sha: string }
  | { kind: 'compare'; owner: string; repo: string; base: string; head: string }
  | { kind: 'gist'; owner: string | null; gistId: string }
  | { kind: 'raw'; owner: string; repo: string; ref: string; path: string };

export function parseGithubUrl(input: string): GithubRef | null; // pure, no network
export function canonicalGithubUrl(ref: GithubRef): string; // stable https URL
export function githubRefKey(ref: GithubRef): string; // dedupe key, lowercased owner/repo
```

### 3.2 Recognized hosts

`github.com`, `www.github.com`, `raw.githubusercontent.com`, `gist.github.com`,
`objects.githubusercontent.com` (release asset → resolves to its release), plus a configurable
`GITHUB_ENTERPRISE_HOST`. Any other host returns `null` and the paste pipeline falls through to the
generic link unfurler (`06_NODE_SYSTEM.md` link node).

### 3.3 Pattern table

| URL shape                                               | `GithubRef.kind`        | Node kind produced                | Notes                                                                                            |
| ------------------------------------------------------- | ----------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/{owner}/{repo}`                                       | `repo`                  | `repository`                      | strips `.git`, trailing `/`, `?tab=`                                                             |
| `/{owner}/{repo}/tree/{ref}`                            | `path` (dir, path `''`) | `repository` pinned to ref        | ref stored in `pinnedRef`                                                                        |
| `/{owner}`                                              | `owner`                 | `person` (user) or `organization` | type resolved by API; until then `ownerType:'unknown'` and node kind `person` with `pendingType` |
| `/orgs/{owner}`                                         | `owner` (org)           | `organization`                    |                                                                                                  |
| `/{owner}/{repo}/tree/{ref}/{path}`                     | `path` dir=true         | `repo_path`                       | folder node                                                                                      |
| `/{owner}/{repo}/blob/{ref}/{path}`                     | `path` dir=false        | `code_file`                       |                                                                                                  |
| `/{owner}/{repo}/blob/{ref}/{path}#L12`                 | `blobRange` (12,null)   | `code_snippet`                    |                                                                                                  |
| `…#L12-L48`                                             | `blobRange` (12,48)     | `code_snippet`                    | max span clamped to 400 lines                                                                    |
| `/{owner}/{repo}/issues/{n}`                            | `issue`                 | `issue`                           |                                                                                                  |
| `/{owner}/{repo}/pull/{n}`                              | `pull`                  | `pull_request`                    | `/pull/{n}/files` and `/pull/{n}#discussion_r…` collapse to the PR                               |
| `/{owner}/{repo}/discussions/{n}`                       | `discussion`            | `discussion`                      |                                                                                                  |
| `/{owner}/{repo}/releases/tag/{tag}`                    | `release`               | `release`                         |                                                                                                  |
| `/{owner}/{repo}/releases/latest`                       | `release` (`latest`)    | `release`                         | resolved at fetch time; stored tag replaces `latest`                                             |
| `/{owner}/{repo}/commit/{sha}`                          | `commit`                | `commit`                          | sha normalized to full 40 hex when the API answers                                               |
| `/{owner}/{repo}/compare/{base}...{head}`               | `compare`               | `note` with diff summary          | not a first-class entity; keeps the graph small                                                  |
| `gist.github.com/{owner}/{id}` or `/{id}`               | `gist`                  | `gist`                            |                                                                                                  |
| `raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}` | `raw`                   | `code_file`                       | canonicalized to the `blob` URL                                                                  |

### 3.4 Canonicalization algorithm

```
parse(input):
  1. trim; if no scheme, prepend "https://"
  2. WHATWG URL parse; on failure return null
  3. lowercase host; strip "www."; if host not in recognized set -> null
  4. drop query params except: `tab` on owner URLs (ignored), `plain=1` on blob (ignored)
  5. percent-decode path segments once; reject any segment containing "/" after decode
  6. match against the ordered pattern table (longest, most specific first)
  7. normalize: owner/repo lowercased for the *key*, original case preserved for display
  8. ref: keep as given; "HEAD" -> repository default branch resolved at fetch
  9. line range: parse `#L(\d+)(?:-L(\d+))?`; if end < start swap; clamp span to 400
```

`canonicalGithubUrl` always emits `https://github.com/...` with original-case owner/repo, no
trailing slash, no query, and the fragment only for `blobRange`.

`githubRefKey` examples: `gh:repo:sherlock-project/sherlock`,
`gh:blob:sherlock-project/sherlock@v0.16.0:sherlock/sherlock.py#L1-L40`,
`gh:issue:smicallef/spiderfoot#1234`. This key is the dedupe identity (§7.2).

### 3.5 Paste behavior (`03_UX.md` paste pipeline)

1. On paste, `parseGithubUrl` runs synchronously (< 1 ms). If it returns a ref, a node is created
   **immediately** in `loading` state with the canonical URL, the correct kind, and a skeleton
   card — no waiting on network.
2. A `github.hydrate` job is enqueued with `{ nodeId, ref, boardId, userId }`.
3. Hydration result is applied as a **direct field patch** on the node the user just created (this
   is not a Proposal: the user explicitly created this node and asked for this exact URL). Nodes
   _derived_ from it (owner, contributors, deps) are always a Proposal.
4. If hydration fails, the node stays valid as a link with an error badge (§9).

Multi-URL paste: up to 50 GitHub URLs in one paste are batched into one job with a single
Proposal for derived nodes; above 50 the UI asks "Create 137 nodes from this paste?" (`03_UX.md`
bulk confirm).

---

## 4. The Repository node

### 4.1 Schema

```ts
// packages/domain/entities/repository.ts
import { z } from 'zod';

export const RepositoryDataSchema = z.object({
  provider: z.literal('github'),
  owner: z.string(),
  name: z.string(),
  fullName: z.string(), // "owner/name", display case
  key: z.string(), // githubRefKey
  htmlUrl: z.string().url(),
  apiUrl: z.string().url(),
  description: z.string().nullable(),
  homepage: z.string().url().nullable(),
  defaultBranch: z.string(),
  pinnedRef: z.string().nullable(), // when the user pasted /tree/{ref}
  visibility: z.enum(['public', 'private', 'internal']),
  isFork: z.boolean(),
  parentFullName: z.string().nullable(),
  isArchived: z.boolean(),
  isTemplate: z.boolean(),
  stars: z.number().int(),
  forks: z.number().int(),
  watchers: z.number().int(),
  openIssues: z.number().int(), // GitHub counts PRs here; see §4.4
  openIssuesOnly: z.number().int().nullable(),
  size: z.number().int(), // KB, as reported
  license: z
    .object({ spdxId: z.string().nullable(), name: z.string(), url: z.string().url().nullable() })
    .nullable(),
  languages: z.array(z.object({ name: z.string(), bytes: z.number().int(), pct: z.number() })),
  primaryLanguage: z.string().nullable(),
  topics: z.array(z.string()),
  createdAt: z.string(), // ISO
  updatedAt: z.string(),
  pushedAt: z.string(),
  latestRelease: z
    .object({
      tag: z.string(),
      name: z.string().nullable(),
      publishedAt: z.string(),
      prerelease: z.boolean(),
      url: z.string().url(),
    })
    .nullable(),
  readme: z
    .object({
      path: z.string(),
      sha: z.string(),
      markdown: z.string(), // raw, capped 256 KB
      renderedHtmlKey: z.string().nullable(), // S3 key of sanitized HTML
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
  analysisId: z.string().uuid().nullable(), // -> RepositoryAnalysis
  fetch: z.object({
    etag: z.string().nullable(),
    lastFetchedAt: z.string(),
    lastStatus: z.enum(['ok', 'not_modified', 'rate_limited', 'not_found', 'forbidden', 'error']),
    authMode: z.enum(['anonymous', 'user', 'app', 'service']),
    staleSince: z.string().nullable(),
  }),
});
export type RepositoryData = z.infer<typeof RepositoryDataSchema>;
```

Provenance (`00_MASTER.md` §1) is carried by the generic node envelope
(`08_DATA_MODEL.md` §3): `source`, `tool: 'github'`, `run_id`, `observed_at`, `confidence`.
Repository metadata fetched directly from the GitHub API has `confidence: 1.0` — it is an
observation of an authoritative source, not an inference. Derived nodes get lower values (§7.3).

### 4.2 Card rendering (canvas)

| Zoom band                         | Rendering                                                                                                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zoom ≥ 0.55` (DOM)               | owner avatar 24 px, `owner/name` (14 px, `--text-primary`), description 2 lines clamped (12 px, `--text-secondary`), badge row: language dot + name, ★ stars (compact `1.2k`), license SPDX, "archived" pill when archived |
| `0.25 ≤ zoom < 0.55` (canvas LOD) | rounded rect, language color bar 4 px on the left, `owner/name` single line, star count                                                                                                                                    |
| `zoom < 0.25`                     | 12×12 glyph with language color only (`05_CANVAS_ENGINE.md` §6 LOD table)                                                                                                                                                  |

Card size: 280 × 132 px default, resizable; min 200 × 96, max 520 × 400.

### 4.3 Sub-panels (inspector)

Opened from the node (`Enter` or double-click) into the right inspector
(`03_UX.md` §7). Tabs are lazy: a tab fetches only when first opened, and each tab caches
independently with its own TTL.

| Tab              | Data                                                                                                                     | Source                                                              | TTL       | Empty state                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------- |
| **README**       | sanitized HTML, TOC, image proxying                                                                                      | `GET /repos/{o}/{r}/readme` + markdown render                       | 24 h      | "This repository has no README." + link                                |
| **Releases**     | last 20, tag/name/date/prerelease/assets count, changelog markdown                                                       | `GET /repos/{o}/{r}/releases?per_page=20`                           | 6 h       | "No releases published."                                               |
| **Issues**       | last 30 open, filter `open/closed/all`, labels, author, comments count                                                   | `GET /repos/{o}/{r}/issues?state=…` (filter out `pull_request` key) | 15 min    | "No open issues."                                                      |
| **Contributors** | top 30 by commits, avatar, login, contributions                                                                          | `GET /repos/{o}/{r}/contributors?per_page=30`                       | 24 h      | "Contributor data unavailable for this repository."                    |
| **Files**        | tree of the default (or pinned) ref, lazy per directory, file size, "open on GitHub", "add as node"                      | `GET /repos/{o}/{r}/git/trees/{ref}` (non-recursive per level)      | 6 h       | "Empty repository."                                                    |
| **Dependencies** | parsed manifests grouped by ecosystem, direct deps with version ranges, "resolve on registry" off by default             | raw manifest fetch + parser (§5.5)                                  | 24 h      | "No dependency manifest detected."                                     |
| **Related**      | forks-of/parent, repos sharing ≥2 topics already on the board, repos linked in README, other boards' repos by same owner | local graph + README link extraction                                | live      | "No related repositories on this board yet."                           |
| **Analysis**     | `RepositoryAnalysis` render + "Propose integration" (§6)                                                                 | analysis job                                                        | on demand | "Run analysis to see structure, entry points and integration options." |

Tab-level errors never blank the card: the tab shows the error strip (§9) and the previously cached
content stays visible with a "stale" marker.

### 4.4 Refresh policy

```ts
const REPO_TTL = {
  hot: 15 * 60_000, // node visible in viewport AND board active in the last 5 min
  warm: 6 * 3_600_000, // node on an open board
  cold: 7 * 24 * 3_600_000, // node on a closed board — refreshed only on open
} as const;
```

Rules:

1. Refresh is **conditional**: always send `If-None-Match: <etag>`. A `304` costs no rate-limit
   quota on GitHub's documented model and is recorded as `lastStatus: 'not_modified'` with a bumped
   `lastFetchedAt`.
2. Refresh is triggered by: board open (batched, max 25 repos per batch, 250 ms apart), explicit
   `R` / "Refresh" action, opening a tab past its TTL, or a scheduled `github.sweep` job for
   boards with `watch: true`.
3. Never refresh a node the user is currently editing.
4. `openIssues` from the API includes PRs. We display "Issues & PRs" unless `openIssuesOnly` was
   computed by a search query; the Issues tab computes it once per TTL and caches it.
5. Repository renames/transfers: a `301` from the API carries the new `full_name`. The adapter
   follows it once, updates `owner`/`name`/`fullName`/`key`, and appends a
   `provenance.renamedFrom` entry. The old key is kept in `aliasKeys[]` so dedupe still matches.
6. Deleted/private-turned repos: `404` → node keeps all cached data, gets
   `fetch.lastStatus: 'not_found'` and a "No longer accessible (last seen {date})" strip. Never
   auto-delete (N8).

### 4.5 Cached artifacts and storage

| Artifact             | Store                  | Key                                       | Limit                                         |
| -------------------- | ---------------------- | ----------------------------------------- | --------------------------------------------- |
| README markdown      | node payload (`jsonb`) | inline                                    | 256 KB, then truncated with `truncated: true` |
| README rendered HTML | S3                     | `gh/readme/{owner}/{repo}/{sha}.html`     | 1 MB                                          |
| README images        | S3 proxy               | `gh/asset/{sha256(url)}`                  | 5 MB each, 25 per README                      |
| Avatars              | S3 proxy               | `gh/avatar/{login}/{sha256(url)}`         | 512 KB                                        |
| Manifest files       | S3                     | `gh/manifest/{owner}/{repo}/{sha}/{path}` | 1 MB each                                     |
| Raw API payloads     | S3, 30-day lifecycle   | `gh/raw/{run_id}/{n}.json`                | 8 MB each                                     |

Markdown rendering happens **server-side** in the worker (unified/remark + rehype-sanitize with a
strict allowlist: no `script`, no `iframe`, no inline `style`, no `on*`, external images rewritten
to our proxy). The client never renders untrusted markdown itself
(`15_SECURITY.md` §4 content sanitization).

---

## 5. Repository Analysis Agent

**Clone-less by design.** No `git clone`, no code execution, no build. Only: GitHub REST (and
GraphQL when probed available) + raw file fetches. This keeps analysis inside the worker instead of
the runner, bounds cost, and eliminates the "we executed a stranger's build script" class of risk.

### 5.1 Pipeline

```text
A. resolve       repo metadata, default branch, HEAD sha           (1 request)
B. tree          git tree of HEAD, recursive=1 (may be truncated)  (1 request)
C. classify      language detection, layout classification         (0, uses B + languages)
D. keyfiles      fetch a bounded key-file set from raw.*           (≤ 10 requests)
E. deps          parse manifests per ecosystem                     (0 network)
F. entrypoints   detect entry points and run commands              (0 network)
G. surface       detect API/CLI/HTTP/library surface               (0 network)
H. container     Dockerfile / compose / published image hints      (0 network)
I. health        license, maintenance-risk scoring                 (≤ 3 requests)
J. llm           optional LLM summarization & gap filling          (0 GitHub requests)
K. emit          RepositoryAnalysis + IntegrationProposal draft
```

Steps A–I are **deterministic**: same inputs → byte-identical output (we hash the inputs into
`inputsDigest`; a repeat run with the same digest returns the cached analysis). Step J is the only
non-deterministic step and its output lives in clearly separated fields (§5.10).

### 5.2 Step B — tree acquisition

```
GET /repos/{o}/{r}/git/trees/{headSha}?recursive=1
if response.truncated:
    strategy = 'bfs'
    fetch root tree, then each directory in a priority order until
    TREE_NODE_BUDGET = 4000 entries or 6 additional requests are used
    priority: /, /src, /lib, /cmd, /app, /packages, /docs, /.github, /scripts
    mark analysis.treeComplete = false
```

Entries are filtered: skip anything under `node_modules/`, `vendor/`, `dist/`, `build/`,
`.venv/`, `target/`, `.git/`, and any path deeper than 12 segments.

### 5.3 Step C — language detection

Primary source: `GET /repos/{o}/{r}/languages` (byte counts per language, authoritative from
GitHub's own linguist). Secondary: extension histogram over the tree, used to
(a) fill in when `languages` is empty (empty/failed response), and (b) detect languages that are
vendored-excluded.

```ts
function detectLanguages(api: Record<string, number>, tree: TreeEntry[]): LanguageStat[] {
  const total = Object.values(api).reduce((a, b) => a + b, 0);
  if (total > 0) {
    return Object.entries(api)
      .map(([name, bytes]) => ({
        name,
        bytes,
        pct: +((100 * bytes) / total).toFixed(2),
        source: 'api' as const,
      }))
      .sort((a, b) => b.bytes - a.bytes);
  }
  const hist = new Map<string, number>();
  for (const e of tree) {
    const lang = EXT_TO_LANG[extname(e.path).toLowerCase()];
    if (lang) hist.set(lang, (hist.get(lang) ?? 0) + 1);
  }
  const files = [...hist.values()].reduce((a, b) => a + b, 0) || 1;
  return [...hist]
    .map(([name, n]) => ({
      name,
      bytes: 0,
      pct: +((100 * n) / files).toFixed(2),
      source: 'heuristic' as const,
    }))
    .sort((a, b) => b.pct - a.pct);
}
```

`primaryLanguage` = first entry with `pct ≥ 15`, else first entry, else `null`.

### 5.4 Step D — key file set (bounded)

Fetched from `https://raw.githubusercontent.com/{o}/{r}/{headSha}/{path}`, in this priority order,
stopping at `KEYFILE_BUDGET = 10` files or `KEYFILE_BYTES = 512 KB` total:

1. `package.json`, `pyproject.toml`, `setup.py`, `requirements*.txt`, `go.mod`, `Cargo.toml`,
   `pom.xml`, `build.gradle(.kts)`, `composer.json`, `Gemfile`, `*.csproj`
2. `Dockerfile`, `docker-compose.y*ml`, `.dockerignore`
3. `Makefile`, `Taskfile.y*ml`, `justfile`
4. `.github/workflows/*.y*ml` (max 2, smallest first)
5. `README*` (already fetched by the node hydration; reused, not refetched)
6. `LICENSE*` (only if the API license field is `null`)
7. `openapi.y*ml|json`, `swagger.json`, `*.proto` (max 2)

Each fetch is size-capped at 256 KB with a streaming abort; oversized files are recorded as
`skipped: 'too_large'`.

### 5.5 Step E — dependency parsing per ecosystem

One parser module per ecosystem, all implementing:

```ts
export interface DependencyParser {
  ecosystem: Ecosystem;
  matches(path: string): boolean;
  parse(path: string, content: string): ParsedManifest; // must not throw; returns errors[]
}

export interface ParsedManifest {
  ecosystem: Ecosystem;
  path: string;
  packageName: string | null;
  version: string | null;
  dependencies: Dependency[];
  errors: string[];
}

export interface Dependency {
  name: string;
  range: string | null; // as written, never resolved
  scope: 'runtime' | 'dev' | 'peer' | 'optional' | 'build' | 'test';
  ecosystem: Ecosystem;
  registryUrl: string | null; // computed, not fetched
  repoUrlGuess: string | null; // only when the manifest itself states a repository URL
}
```

Per-ecosystem rules (all parse-only, no network, no lockfile resolution in v1):

| Ecosystem              | Files                                             | Extracted                                                                                                                                        | Notes                                                                                                                                        |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| npm                    | `package.json`                                    | `name`, `version`, `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `bin`, `main`, `exports`, `scripts`, `engines` | `bin` and `scripts` feed steps F/G                                                                                                           |
| pip                    | `pyproject.toml`, `setup.py`, `requirements*.txt` | PEP 621 `project.dependencies`, `optional-dependencies`, poetry `tool.poetry.dependencies`, `project.scripts`                                    | `setup.py` parsed with a regex-restricted reader (`install_requires=[...]` literal lists only); non-literal → `errors: ['setup.py dynamic']` |
| go                     | `go.mod`                                          | `module`, `go` version, `require` blocks, `// indirect` marks → scope `build`                                                                    |                                                                                                                                              |
| cargo                  | `Cargo.toml`                                      | `package.name/version`, `dependencies`, `dev-dependencies`, `build-dependencies`, `[[bin]]`, `[lib]`                                             | workspace members listed as sub-manifests when present in the tree                                                                           |
| maven                  | `pom.xml`                                         | `groupId:artifactId`, `version`, `<dependencies>`, `<modules>`                                                                                   | property placeholders `${x}` resolved only from `<properties>` in the same file                                                              |
| gradle                 | `build.gradle`, `build.gradle.kts`                | line-matched `implementation "g:a:v"` style declarations                                                                                         | explicitly marked `confidence: 'low'` — Gradle files are programs                                                                            |
| composer / gem / nuget | `composer.json`, `Gemfile`, `*.csproj`            | direct deps                                                                                                                                      | best-effort, `low` confidence for `Gemfile` blocks                                                                                           |

Dependency count is capped at 500 per manifest; the remainder is summarized as
`truncatedDependencies: n`.

### 5.6 Step F — entry points and run detection

Deterministic rules, each producing an `EntryPoint` with a `rule` field naming the rule that fired
(so the UI can explain every conclusion):

| Rule id              | Condition                                                                                     | Emits                                     |
| -------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `npm.bin`            | `package.json.bin` present                                                                    | CLI entry per bin name, `run: npx {name}` |
| `npm.scripts`        | `scripts.start` / `dev` / `build`                                                             | run commands with those exact strings     |
| `npm.main`           | `main`/`module`/`exports`                                                                     | library entry                             |
| `py.console_scripts` | `project.scripts` or `entry_points.console_scripts`                                           | CLI entry                                 |
| `py.dunder_main`     | `**/__main__.py` in tree                                                                      | `python -m {package}`                     |
| `py.toplevel_script` | root-level `*.py` with `if __name__ == "__main__"` (needs file fetch; only if budget remains) | `python {file}`                           |
| `go.cmd`             | `cmd/*/main.go`                                                                               | one CLI entry per `cmd/*`                 |
| `go.rootmain`        | root `main.go` with `package main`                                                            | `go run .`                                |
| `cargo.bin`          | `[[bin]]` or `src/main.rs`                                                                    | `cargo run --bin {name}`                  |
| `maven.mainclass`    | `<mainClass>` in pom                                                                          | `java -cp … {class}`                      |
| `docker.cmd`         | `Dockerfile` `ENTRYPOINT`/`CMD`                                                               | container run command                     |
| `compose.service`    | `docker-compose.yml` services                                                                 | `docker compose up {service}`             |
| `make.target`        | `Makefile` targets named `run`/`start`/`dev`/`serve`                                          | `make {target}`                           |
| `ci.workflow`        | workflow `run:` steps                                                                         | build/test commands, `confidence: medium` |

Each entry point carries `confidence: 'high' | 'medium' | 'low'`: `high` when the manifest declares
it explicitly, `medium` when inferred from conventional layout, `low` when regex-matched from a
programmatic file (Gradle, Makefile with variables).

### 5.7 Step G — API/CLI surface detection

```
surface.cli      = entryPoints where type === 'cli'
                   + flags parsed from README fenced code blocks matching /^\s*(-{1,2}[a-z0-9][\w-]*)/
                     (deduped, max 40, marked source:'readme')
surface.http     = openapi/swagger file found -> parse paths (max 200), source:'openapi'
                   else framework signature scan over the tree:
                     express/fastify/flask/fastapi/django/gin/actix/spring -> 'framework-detected',
                     paths unknown -> record framework only
surface.library  = package manifest declares an importable entry (npm main/exports, py packages,
                   go module path, cargo lib, maven artifact)
surface.grpc     = any *.proto -> service names parsed by regex `service\s+(\w+)`
surface.mcp      = presence of "modelcontextprotocol" dependency or an `mcp.json`
```

We never claim an HTTP route we did not read from a spec file. Framework detection yields
`{ framework, routesKnown: false }` — this is exactly the kind of honesty the SpiderFoot adapter
also requires (`12_SPIDERFOOT.md` §4 assumptions).

### 5.8 Step H/I — container support, license, maintenance risk

Container:

```ts
container: {
  dockerfile: string | null,          // path
  compose: string[],                  // paths
  baseImages: string[],               // FROM lines, stripped of AS aliases
  exposedPorts: number[],             // EXPOSE
  publishedImageHints: string[],      // image refs found in README/compose, never verified
  rootUser: boolean | null,           // true if no USER directive or USER root
}
```

Maintenance risk score — deterministic, documented, 0 (healthy) … 100 (risky):

```
daysSincePush        = now - pushed_at
daysSinceRelease     = now - latestRelease.publishedAt   (or daysSincePush if no releases)
openIssueRatio       = openIssues / max(1, stars)

score = 0
score += clamp(daysSincePush / 30 * 8, 0, 40)            // 40 pts max: staleness
score += clamp(daysSinceRelease / 90 * 6, 0, 20)         // 20 pts max: release cadence
score += archived ? 25 : 0
score += (contributorsCount <= 1) ? 10 : (contributorsCount <= 3 ? 5 : 0)
score += (license === null) ? 10 : 0
score -= clamp(log10(max(1, stars)) * 2, 0, 8)           // popularity mitigates slightly
score  = clamp(round(score), 0, 100)

band = score < 20 ? 'healthy'
     : score < 45 ? 'watch'
     : score < 70 ? 'at-risk'
     : 'unmaintained'
```

Worked example, SpiderFoot (`smicallef/spiderfoot`, stable v4.0, and per deps.dev in June 2026 zero
commit/issue activity in the preceding 90 days): staleness and release-cadence terms saturate,
producing band `unmaintained`. This is the score that `12_SPIDERFOOT.md` §1 cites; the two
documents must stay consistent.

License handling: prefer the API `license.spdx_id`. If `NOASSERTION` or `null` and a `LICENSE` file
exists, record `licenseDetected: { spdxGuess, method: 'text-match', confidence }` using a
first-2 KB hash match against a bundled SPDX text table. We never assert a license we could not
match; unmatched → `spdxGuess: null, note: 'License file present but unrecognized'`.

### 5.9 Request budget

| Mode             | Max GitHub requests per analysis | Skipped when exceeded                          |
| ---------------- | -------------------------------- | ---------------------------------------------- |
| anonymous        | 12                               | key files 5–7, workflows, contributors page 2+ |
| user OAuth       | 30                               | nothing (steps fit)                            |
| app installation | 30                               | nothing                                        |

The budget is enforced by a counting HTTP client; exceeding it does not fail the analysis — it sets
`analysis.completeness` below 1 and lists `skippedSteps[]`. A partial analysis is still emitted
and clearly labeled in the UI: "Partial analysis — 4 of 10 steps skipped due to the anonymous rate
budget. Connect GitHub for a full analysis."

### 5.10 Output schema

```ts
// packages/domain/entities/repository-analysis.ts
export const RepositoryAnalysisSchema = z.object({
  id: z.string().uuid(),
  repoKey: z.string(), // gh:repo:owner/name
  headSha: z.string(),
  inputsDigest: z.string(), // sha256 of (headSha + keyfile shas + analyzer version)
  analyzerVersion: z.string(), // semver of the analysis pipeline
  producedAt: z.string(),
  completeness: z.number().min(0).max(1),
  skippedSteps: z.array(z.string()),
  treeComplete: z.boolean(),

  languages: z.array(
    z.object({
      name: z.string(),
      bytes: z.number(),
      pct: z.number(),
      source: z.enum(['api', 'heuristic']),
    }),
  ),
  primaryLanguage: z.string().nullable(),

  layout: z.object({
    kind: z.enum(['single-package', 'monorepo', 'multi-module', 'unknown']),
    packages: z.array(
      z.object({ path: z.string(), ecosystem: z.string(), name: z.string().nullable() }),
    ),
    docsDirs: z.array(z.string()),
    testDirs: z.array(z.string()),
    ciProviders: z.array(z.string()),
  }),

  entryPoints: z.array(
    z.object({
      type: z.enum(['cli', 'service', 'library', 'script', 'container']),
      name: z.string(),
      path: z.string().nullable(),
      runCommand: z.string().nullable(),
      rule: z.string(), // rule id from §5.6
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ),

  build: z.object({
    systems: z.array(z.string()), // npm, poetry, go, cargo, maven, make, docker
    commands: z.array(
      z.object({
        purpose: z.enum(['install', 'build', 'test', 'run', 'lint']),
        command: z.string(),
        rule: z.string(),
      }),
    ),
    runtimeVersions: z.record(z.string()), // { node: ">=22", python: ">=3.9" }
  }),

  dependencies: z.array(
    z.object({
      ecosystem: z.string(),
      path: z.string(),
      packageName: z.string().nullable(),
      direct: z.number().int(),
      dev: z.number().int(),
      truncated: z.number().int(),
      top: z.array(z.object({ name: z.string(), range: z.string().nullable(), scope: z.string() })),
      parseErrors: z.array(z.string()),
    }),
  ),

  surface: z.object({
    cli: z.array(z.object({ command: z.string(), flags: z.array(z.string()), source: z.string() })),
    http: z.object({
      spec: z.string().nullable(),
      framework: z.string().nullable(),
      routesKnown: z.boolean(),
      routes: z.array(z.string()),
    }),
    grpc: z.array(z.string()),
    library: z.boolean(),
    mcp: z.boolean(),
  }),

  container: z.object({
    dockerfile: z.string().nullable(),
    compose: z.array(z.string()),
    baseImages: z.array(z.string()),
    exposedPorts: z.array(z.number().int()),
    publishedImageHints: z.array(z.string()),
    rootUser: z.boolean().nullable(),
  }),

  health: z.object({
    license: z.object({
      spdxId: z.string().nullable(),
      method: z.enum(['api', 'text-match', 'none']),
      permissive: z.boolean().nullable(),
    }),
    maintenanceScore: z.number().int().min(0).max(100),
    maintenanceBand: z.enum(['healthy', 'watch', 'at-risk', 'unmaintained']),
    signals: z.array(z.object({ signal: z.string(), value: z.string(), points: z.number() })),
    archived: z.boolean(),
    contributorsCount: z.number().int().nullable(),
  }),

  narrative: z.object({
    // step J, LLM-authored, clearly separated
    summary: z.string().nullable(), // ≤ 120 words
    architecture: z.string().nullable(), // ≤ 200 words
    integrationNotes: z.string().nullable(),
    model: z.string().nullable(),
    generatedAt: z.string().nullable(),
  }),
});
export type RepositoryAnalysis = z.infer<typeof RepositoryAnalysisSchema>;
```

Example (abbreviated, for `sherlock-project/sherlock` — a repository whose public facts are
verified in `13_SHERLOCK.md` §1):

```json
{
  "repoKey": "gh:repo:sherlock-project/sherlock",
  "analyzerVersion": "1.0.0",
  "completeness": 1,
  "primaryLanguage": "Python",
  "layout": {
    "kind": "single-package",
    "packages": [{ "path": ".", "ecosystem": "pip", "name": "sherlock-project" }],
    "docsDirs": ["docs"],
    "testDirs": ["tests"],
    "ciProviders": ["github-actions"]
  },
  "entryPoints": [
    {
      "type": "cli",
      "name": "sherlock",
      "path": null,
      "runCommand": "sherlock {username}",
      "rule": "py.console_scripts",
      "confidence": "high"
    },
    {
      "type": "container",
      "name": "docker",
      "path": "Dockerfile",
      "runCommand": "docker run --rm sherlock/sherlock {username}",
      "rule": "docker.cmd",
      "confidence": "high"
    }
  ],
  "surface": {
    "cli": [
      {
        "command": "sherlock",
        "flags": ["--json", "--site", "--timeout", "--print-found", "--nsfw", "--local", "--proxy"],
        "source": "readme"
      }
    ],
    "http": { "spec": null, "framework": null, "routesKnown": false, "routes": [] },
    "grpc": [],
    "library": true,
    "mcp": false
  },
  "health": {
    "license": { "spdxId": "MIT", "method": "api", "permissive": true },
    "maintenanceScore": 8,
    "maintenanceBand": "healthy",
    "signals": [{ "signal": "latest release", "value": "v0.16.0 (2025-09-16)", "points": 0 }],
    "archived": false,
    "contributorsCount": null
  }
}
```

### 5.11 Static analysis vs LLM — the split

| Concern                                                    | Owner                                                                          | Why                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| Language stats, layout, tree                               | static                                                                         | measurable                                         |
| Dependency lists, versions                                 | static                                                                         | must be exact; hallucinated deps are dangerous     |
| Entry points, build/run commands                           | static (rules)                                                                 | must be executable verbatim                        |
| CLI flags                                                  | static (README code-block regex) + LLM _may only re-order/annotate_, never add | adding a flag that does not exist breaks execution |
| HTTP routes                                                | static (spec file only)                                                        | never guess                                        |
| License, maintenance score                                 | static (formula)                                                               | must be reproducible and auditable                 |
| Prose summary, architecture description, integration notes | LLM                                                                            | genuinely a summarization task                     |
| Integration Proposal _fields_                              | static from the above                                                          | proposals become executable manifests              |
| Integration Proposal _rationale text_                      | LLM                                                                            | explanation only                                   |

Guardrails for step J (see `14_AI_AGENT.md` §6 for the shared rules):

1. The LLM receives **only** the static analysis JSON plus ≤ 8 KB of README text. It never receives
   arbitrary repository code.
2. Output is constrained by a zod schema; a parse failure retries once, then `narrative` stays
   `null` and the analysis is still valid.
3. The narrative is stored in its own object, rendered in the UI under an "AI summary" label with a
   model badge, and excluded from any exported "facts" table
   (`15_PRESENTATION`/`15_SECURITY.md` provenance rules; export marks it `derived: true`).
4. Token budget: 6 000 input / 700 output per analysis; cost accounted to the user's AI budget
   (`14_AI_AGENT.md` §9).
5. Prompt injection: README content is wrapped in a delimited block with the instruction that its
   contents are data, never instructions; the response schema has no field that can trigger an
   action. Even a fully compromised narrative cannot create nodes, because nodes come from the
   static fields only.

### 5.12 Caching and invalidation

- Key: `(repoKey, headSha, analyzerVersion)`. A re-run with the same key returns the stored row
  in < 50 ms and consumes zero GitHub quota.
- A new `headSha` invalidates; the previous analysis is kept for diffing ("what changed since
  your last analysis": languages, new/removed deps, new entry points, maintenance band change).
- Analyzer version bumps invalidate all analyses lazily (on next request).

---

## 6. Integration Proposal (repository → candidate manifest)

An analysis of a _tool-like_ repository can be turned into a draft Raven integration manifest
(`10_INTEGRATIONS.md` §3 manifest schema). This is the roadmap requirement §14 item 11.

### 6.1 Eligibility

A repository is proposal-eligible when **all** hold:

- `surface.cli.length > 0` **or** `surface.http.spec !== null` **or** `container.dockerfile !== null`
- `health.license.permissive === true` (MIT/Apache-2.0/BSD/ISC/MPL-2.0); otherwise the proposal is
  produced but blocked with `blockers: ['license']` and cannot be installed without an operator
  override recorded in the audit log.
- `layout.kind !== 'unknown'`

### 6.2 Draft shape

```ts
export interface IntegrationProposal {
  id: string;
  repoKey: string;
  analysisId: string;
  generatedAt: string;
  executionMode: 'container' | 'http-api' | 'unsupported';
  confidence: number; // 0..1, computed (§6.3)
  requiresHumanReview: true; // always true, never auto-installed
  blockers: Array<'license' | 'no-entrypoint' | 'network-required' | 'unmaintained' | 'root-user'>;
  draftManifest: {
    id: string; // slugified owner-repo
    name: string;
    version: '0.1.0-draft';
    repository: string;
    execution: {
      kind: 'container';
      image: string | null; // publishedImageHints[0] ?? null (unverified)
      build: { dockerfile: string } | null;
      command: string[]; // argv template with ${input.x} placeholders
      timeoutMs: number; // default 300_000
      network: 'none' | 'allowlist';
      egressAllowlist: string[]; // [] unless the analysis found explicit hosts
    };
    inputs: Array<{
      name: string;
      type: 'string' | 'url' | 'email' | 'username' | 'domain' | 'ip';
      required: boolean;
      flag: string | null;
    }>;
    outputs: {
      format: 'json' | 'jsonl' | 'csv' | 'text';
      path: string | null;
      flag: string | null;
    };
    parserHint: string; // free text for the implementer
    proposedNodeKinds: string[];
    proposedEdgeKinds: string[];
  };
  rationale: string; // LLM prose, labeled
  unverified: string[]; // every field the system could not verify
}
```

### 6.3 Confidence

```
c = 0.25 * (hasDeclaredCli ? 1 : 0)
  + 0.20 * (hasStructuredOutputFlag ? 1 : 0)     // --json / --output / openapi spec
  + 0.20 * (container.dockerfile || publishedImageHints.length ? 1 : 0)
  + 0.15 * (license.permissive ? 1 : 0)
  + 0.10 * (maintenanceBand === 'healthy' ? 1 : maintenanceBand === 'watch' ? 0.5 : 0)
  + 0.10 * (docsDirs.length || readme.length > 2000 ? 1 : 0)
```

Displayed as a band: `< 0.4` "Exploratory", `0.4–0.7` "Plausible", `> 0.7` "Strong candidate".
No proposal is ever installed automatically — `requiresHumanReview` is a literal `true` in the
type, and the installer route rejects any manifest whose provenance is a proposal without a
recorded human approval (`10_INTEGRATIONS.md` §8 install flow).

### 6.4 Review UI

A three-pane sheet: left = draft manifest YAML (editable), middle = the evidence for every field
(which rule produced it, with a link to the file/line), right = a dry-run panel that executes the
proposed command in the runner with `--network none` against a fixture input and shows stdout,
exit code, and whether the output parsed. Only after a successful dry-run does "Install as
integration" enable. Everything unverified is listed in red in the `unverified[]` strip, e.g.
"Container image `sherlock/sherlock` was read from the README and has not been pulled or verified".

---

## 7. Graph mapping

### 7.1 Nodes and edges created

Direct hydration (no Proposal — user-initiated node):

| From                        | Node                                | Fields                                               |
| --------------------------- | ----------------------------------- | ---------------------------------------------------- |
| `repo` ref                  | `repository`                        | §4.1                                                 |
| `owner` ref                 | `person` or `organization`          | login, name, avatar, url, type                       |
| `issue`/`pull`/`discussion` | `issue`/`pull_request`/`discussion` | number, title, state, author, labels, createdAt, url |
| `release`                   | `release`                           | tag, name, publishedAt, assets[], url                |
| `commit`                    | `commit`                            | sha, message (first line), author, date, url         |
| `path`/`blobRange`          | `code_file`/`code_snippet`          | path, ref, lines, content (≤ 64 KB), language        |
| `gist`                      | `gist`                              | id, description, files[], owner                      |

Derived (always inside one Import Proposal, `10_INTEGRATIONS.md` §7):

| Edge             | From → To                        | Created when                                                          |
| ---------------- | -------------------------------- | --------------------------------------------------------------------- |
| `owned_by`       | repository → person/organization | always                                                                |
| `contributed_to` | person → repository              | contributor import (opt-in, top N chosen by the user)                 |
| `forked_from`    | repository → repository          | `isFork` and parent known                                             |
| `depends_on`     | repository → package/repository  | dependency import (opt-in, only direct deps)                          |
| `released`       | repository → release             | release import                                                        |
| `references`     | issue/PR → repository            | always for those node kinds                                           |
| `authored`       | person → issue/PR/commit         | when the author is resolvable to a node                               |
| `mentioned_in`   | repository → repository          | README link extraction (`confidence 0.5`)                             |
| `related_to`     | repository → repository          | shares ≥ 2 topics with a repo already on the board (`confidence 0.4`) |
| `has_file`       | repository → code_file           | file added from the Files tab                                         |

Default proposal size guard: a dependency import proposes at most **40** package nodes; beyond
that it proposes one `dependency_group` summary node per ecosystem with a count and an "expand"
action (same pattern as `12_SPIDERFOOT.md` §7 volume control).

### 7.2 Dedupe rules

Resolution order when a candidate node is about to be created:

1. **Exact key**: `githubRefKey` equality (case-insensitive owner/repo) against `nodes.external_key`
   on the board. Match → merge, do not create.
2. **Alias key**: candidate key ∈ existing `aliasKeys[]` (renamed repos). Match → merge and record
   `renamedFrom`.
3. **Person identity**: `person` nodes match on `github:{userId}` (numeric id, stable across renames)
   first, then on `github:login` case-insensitively. Numeric id wins; a login collision with a
   different id creates a **separate** node and flags both with a "possible rename/impersonation"
   review chip.
4. **Package identity**: `pkg:{ecosystem}:{name}` lowercased.
5. **Fuzzy**: nothing. We never dedupe repositories by name similarity — `owner/name` is exact by
   construction.

Merge semantics: newer `observed_at` wins per field; provenance arrays are unioned; user-edited
fields (tracked by `node.userOverrides[]`) are **never** overwritten by a refresh — the refresh
records the incoming value in `pendingUpdates` and the inspector shows "GitHub reports a different
description — accept?" (N4-consistent, since this is a change to user data).

### 7.3 Enrichment of existing person/username nodes

This is where GitHub meets Sherlock (`13_SHERLOCK.md` §5). A `username` node created by Sherlock
(`sherlock:{handle}`) and a GitHub `person` node (`github:{id}`) are **different entities** and are
not merged automatically. Instead:

1. When a Sherlock run reports a claimed GitHub profile for handle `h`, and a `person` node with
   `login === h` exists (or is fetched), a **link proposal** is created:
   edge `same_as` with `confidence: 0.55`, labeled "Same handle on GitHub — verify".
2. Confidence is raised, and only as a **suggestion**, when corroborating fields match:
   `+0.15` display-name match (normalized), `+0.15` avatar perceptual-hash match,
   `+0.15` a URL in the GitHub profile matching another node on the board. Cap `0.9`.
   Raven never emits `1.0` for identity equivalence between platforms — see `13_SHERLOCK.md` §4
   (never assert attribution).
3. Enrichment writes to the existing node only through the Proposal diff view: added fields appear
   green, changed fields amber with the old value shown.

---

## 8. Rate limiting and budget accounting

### 8.1 Primary limit

- Every response updates a per-credential budget record in Redis:
  `gh:budget:{credentialId}` → `{ limit, remaining, reset, resource }` with TTL to `reset`.
- Before a request, the client checks `remaining`. Thresholds:
  - `remaining > 20%` → proceed.
  - `5%–20%` → only user-initiated requests proceed; background refresh jobs are deferred to
    `reset` (BullMQ delayed job).
  - `< 5%` → only the request that a user is actively waiting on, and the UI shows the quota strip.
  - `0` → all requests rejected locally with `RATE_LIMITED` and `retryAt = reset`. We never burn a
    request just to learn we are limited.
- Conditional requests (`If-None-Match`) are used everywhere and a `304` is not counted against our
  local accounting (matching GitHub's documented behavior). If the capability probe cannot confirm
  header presence, we conservatively count every request.

### 8.2 Secondary rate limits / abuse detection

Signals: HTTP `403` or `429` with `retry-after`, or a body containing `secondary rate limit`.

```
onSecondaryLimit(resp):
  wait = resp.headers['retry-after'] ? seconds(resp) : backoff(attempt)
  backoff(attempt) = min(60_000 * 2^attempt, 15 * 60_000) * jitter(0.8..1.2)
  pause the entire credential's queue for `wait` (Redis lock gh:pause:{credentialId})
  max 5 attempts, then fail the job with SECONDARY_LIMIT and surface §9 copy
```

Additional hard rules regardless of remaining quota:

- max **10 concurrent** requests per credential,
- max **1 write-ish request per second** (we have none, but the limiter is shared),
- serialize requests to the same repository (no parallel storms on one repo),
- global instance ceiling `GITHUB_MAX_RPS = 20` to protect the shared IP in anonymous mode.

### 8.3 Per-user budget accounting

```sql
CREATE TABLE github_usage (
  credential_id uuid NOT NULL,
  user_id       uuid NOT NULL,
  hour_bucket   timestamptz NOT NULL,
  requests      int NOT NULL DEFAULT 0,
  not_modified  int NOT NULL DEFAULT 0,
  rate_limited  int NOT NULL DEFAULT 0,
  PRIMARY KEY (credential_id, hour_bucket)
);
```

Surfaced in Settings → Integrations → GitHub as a 24 h sparkline plus
"1,847 of 5,000 requests used this hour · resets in 22 min". Analysis jobs display their cost
estimate before running ("This analysis will use up to 12 API requests").

### 8.4 Graceful degradation when unauthenticated

| Feature         | Authenticated     | Anonymous                                         |
| --------------- | ----------------- | ------------------------------------------------- |
| Repo metadata   | full              | full (public only)                                |
| README          | full              | full                                              |
| Releases        | 20                | 5                                                 |
| Issues          | 30, filterable    | 10, open only                                     |
| Contributors    | 30                | 10                                                |
| Files tree      | full lazy tree    | root + one level                                  |
| Dependencies    | all manifests     | first 2 manifests                                 |
| Analysis        | full pipeline     | budget-capped (§5.9), `completeness < 1`          |
| Private repos   | with `repo` scope | not available — explicit copy, never a blank card |
| Refresh cadence | TTL as §4.4       | ×4 TTLs                                           |

The degradation is always **visible**, never silent: the affected panel shows a compact
"Connect GitHub to see all N" affordance with the exact benefit stated.

---

## 9. Error copy and quota UX

Every message follows `00_MASTER.md` §10.5 (what happened / why / what to do). Codes are stable and
used in telemetry.

| Code                  | Trigger           | Title                             | Body                                                                                                                    | Primary action                                           |
| --------------------- | ----------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GH_RATE_PRIMARY`     | remaining = 0     | "GitHub rate limit reached"       | "Your GitHub quota resets at 14:32 (in 22 min). Cached data is still shown."                                            | "Connect an account" (anon) / "Notify me when it resets" |
| `GH_RATE_SECONDARY`   | 403/429 secondary | "GitHub is throttling requests"   | "Too many requests in a short time. Raven paused GitHub calls for 2 min and will resume automatically."                 | "Retry now" (disabled until timer)                       |
| `GH_NOT_FOUND`        | 404               | "Repository not accessible"       | "github.com/{o}/{r} returned 404 — it may be private, renamed or deleted. The data from {date} is still on the canvas." | "Open on GitHub"                                         |
| `GH_FORBIDDEN`        | 403 non-rate      | "Access denied by GitHub"         | "Your GitHub connection lacks access to this resource. Private repositories need the `repo` scope."                     | "Reconnect with private access"                          |
| `GH_AUTH_REVOKED`     | 401               | "GitHub connection expired"       | "Your GitHub authorization was revoked or expired. Existing data is intact."                                            | "Reconnect"                                              |
| `GH_NETWORK`          | timeout/DNS       | "Could not reach GitHub"          | "The request timed out after 15 s. This is usually temporary."                                                          | "Retry"                                                  |
| `GH_PARSE`            | malformed payload | "Unexpected response from GitHub" | "Raven could not read GitHub's response for this panel. The raw payload was saved for diagnostics."                     | "Report issue" (attaches run id)                         |
| `GH_TOO_LARGE`        | file > cap        | "File too large to preview"       | "This file is 12.4 MB; Raven previews up to 256 KB."                                                                    | "Open on GitHub"                                         |
| `GH_ANALYSIS_PARTIAL` | completeness < 1  | "Partial analysis"                | "4 of 10 steps were skipped because of the anonymous request budget."                                                   | "Connect GitHub and re-run"                              |
| `GH_TRUNCATED_TREE`   | tree truncated    | "Large repository"                | "This repository's file tree exceeds GitHub's single-response limit; Raven analyzed the {n} most relevant directories." | "See what was analyzed"                                  |

Quota UX states (`03_UX.md` state table format):

| State          | Visual                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| normal (> 20%) | nothing shown                                                                                                                  |
| low (5–20%)    | amber dot on the GitHub icon in the status bar; tooltip with numbers                                                           |
| exhausted      | status-bar strip "GitHub quota exhausted · resets in 22 min", background refresh badge on affected nodes turns to a clock icon |
| throttled      | same strip, spinner variant, "resuming automatically"                                                                          |
| disconnected   | "GitHub not connected — public data only" chip in Integrations menu                                                            |
| loading        | skeleton card with the canonical URL already readable                                                                          |
| success        | brief 180 ms border pulse using `--accent-success`, no toast (`03_UX.md` no-toast-for-expected-success rule)                   |
| empty          | per-tab empty copy (§4.3)                                                                                                      |
| undo           | any accepted GitHub Proposal is one `Ctrl+Z` away; the undo toast names it: "Undid: import 12 nodes from github/sherlock"      |

---

## 10. Job definitions

| Queue job         | Payload                               | Concurrency | Retries                     | Idempotency key                                 |
| ----------------- | ------------------------------------- | ----------- | --------------------------- | ----------------------------------------------- |
| `github.hydrate`  | `{ nodeId, ref, boardId, userId }`    | 8           | 3, exp backoff 2 s/8 s/30 s | `hydrate:{nodeId}:{refKey}`                     |
| `github.tab`      | `{ nodeId, tab, force }`              | 8           | 2                           | `tab:{nodeId}:{tab}`                            |
| `github.analyze`  | `{ repoKey, userId, boardId, force }` | 2           | 1                           | `analyze:{repoKey}:{headSha}:{analyzerVersion}` |
| `github.proposal` | `{ analysisId }`                      | 2           | 1                           | `proposal:{analysisId}`                         |
| `github.sweep`    | `{ boardId }` cron 30 min             | 1           | 0                           | `sweep:{boardId}:{hour}`                        |

All jobs are cancelable from the run history UI (`10_INTEGRATIONS.md` §9); cancellation aborts the
in-flight fetch via `AbortController` and marks the run `canceled`, never `failed`.

---

## 11. Testing requirements (feeds `18_TESTING.md`)

1. **URL corpus test**: ≥ 120 URLs (valid, hostile, encoded, unicode owner names, GHES hosts,
   `..` traversal attempts, `@` userinfo tricks) asserting `parseGithubUrl` output and that no
   parse triggers a network call.
2. **SSRF corpus** (N7): raw-file host pinning, redirect cap 3, private-range denial.
3. **Fixture-driven analysis tests**: 8 recorded repository fixtures (npm monorepo, poetry CLI,
   go multi-cmd, cargo workspace, maven multi-module, dockerized service, archived repo, empty
   repo) with golden `RepositoryAnalysis` JSON; the analyzer must be byte-stable for steps A–I.
4. **Rate-limit simulation**: a mock GitHub returning `403 secondary`, `429`, `304`, `301` and
   header-less responses; assert budget accounting, pause behavior and the exact error codes.
5. **Proposal safety**: a fixture README containing prompt-injection text must not change any
   static field of the analysis or the draft manifest.
6. **Dedupe**: rename scenario (repo renamed, then re-pasted under both names → one node).

---

## Open risks

1. **GitHub API shape drift.** Field names and pagination behavior can change without notice.
   Mitigation: every response is parsed through a _tolerant_ zod schema (`.passthrough()`,
   optional fields, `catch` defaults); a parse deviation raises `GH_PARSE`, stores the raw payload,
   and never crashes a panel. A weekly synthetic check in CI hits 3 public endpoints and fails
   loudly on shape change.
2. **Anonymous IP budget is shared** across every user of a self-hosted instance. Multi-user
   instances without any credential will hit `GH_RATE_PRIMARY` quickly. Mitigation: the onboarding
   flow nudges an instance service token; the Settings page shows the shared-budget warning.
3. **GraphQL not probed available** on some GHES versions → 2–3× more REST requests per analysis.
   Accepted; budget table (§5.9) is sized for the REST path.
4. **Gradle/`setup.py` dependency parsing is heuristic** and can miss or mis-attribute deps. Marked
   `confidence: 'low'` in the UI; never used as an input to the maintenance score.
5. **Maintenance score is a heuristic, not a verdict.** It is presented with the signal breakdown
   so a human can disagree. Any downstream document (notably `12_SPIDERFOOT.md`) must cite the
   band, not treat it as fact about project quality.
6. **Integration Proposals may reference container images that do not exist** (README hints are
   unverified). Mitigation: the dry-run pane must pull-and-run before install can be enabled, and
   `unverified[]` is rendered prominently.
7. **Perceptual-hash avatar matching (§7.3) can produce false links** for default/generated
   avatars. Mitigation: skip hashing for GitHub identicon-pattern avatars, and cap identity
   confidence at 0.9 with mandatory human confirmation.
