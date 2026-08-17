# NEXUS — 09 BACKEND

## Services, APIs, jobs, files, observability

**Scope**
This document specifies the server side of NEXUS: `apps/api` (Fastify 5 + tRPC v11 + REST/OpenAPI),
`apps/sync` (Hocuspocus 4 + projection) and `apps/worker` (BullMQ consumers, unfurl, files, AI,
exports, maintenance). `apps/runner` is specified in `10_INTEGRATIONS.md` §5–§8 and is referenced,
not duplicated here. It refines `00_MASTER.md` §2 and `02_ARCHITECTURE.md` §1, §6–§11; database
schema details live in `08_DATA_MODEL.md`, security controls in `15_SECURITY.md`.
All request/response shapes below are zod schemas that exist verbatim in the codebase.

---

## 1. Service inventory

| Service       | Entry                       | Port                | Public?              | Replicas (prod)     | Health                                         |
| ------------- | --------------------------- | ------------------- | -------------------- | ------------------- | ---------------------------------------------- |
| `apps/api`    | `src/main.ts`               | 3001                | yes (behind ingress) | ≥ 3                 | `/healthz` (liveness), `/readyz` (db+redis+s3) |
| `apps/sync`   | `src/main.ts`               | 1234                | yes (WSS only)       | ≥ 3                 | `/healthz`, `/readyz` (db+redis)               |
| `apps/worker` | `src/main.ts`               | 3100 (metrics only) | no                   | ≥ 2 per queue group | `/healthz`, `/metrics`                         |
| `apps/runner` | see `10_INTEGRATIONS.md` §5 | 3200 (mTLS)         | no                   | ≥ 2                 | `/healthz`                                     |

Shared code: `packages/db` (Prisma + repositories + projection), `packages/domain` (schemas,
serializers, proposal logic), `packages/platform` (env, logger, metrics, authz, ssrf, flags),
`packages/integrations` (manifests + parsers, imported by worker only).

---

## 2. `apps/api` — Fastify 5 application

### 2.1 File layout

```text
apps/api/src/
├─ main.ts                    // boot: env → plugins → routes → listen → graceful shutdown
├─ plugins/
│  ├─ auth.ts                 // Better-Auth handler mount + session resolution
│  ├─ context.ts              // AuthContext, txId, RLS session var
│  ├─ rate-limit.ts           // Redis token buckets
│  ├─ error.ts                // NexusError mapping (02_ARCHITECTURE.md §6)
│  ├─ otel.ts                 // tracing + metrics
│  └─ openapi.ts              // spec generation + /api/v1/openapi.json + docs
├─ router/                    // tRPC
│  ├─ index.ts                // AppRouter (exported type only to the client)
│  ├─ trpc.ts                 // t, procedures, middlewares
│  ├─ auth.ts  projects.ts  boards.ts  nodes.ts  files.ts  unfurl.ts
│  ├─ search.ts tags.ts      integrations.ts runs.ts ai.ts exports.ts admin.ts
├─ rest/                      // /api/v1 controllers (thin, over services/)
│  ├─ v1/boards.ts  nodes.ts  runs.ts  webhooks.ts  files.ts  search.ts
├─ services/                  // business orchestration, shared by tRPC and REST
│  ├─ board.service.ts  node.service.ts  file.service.ts  unfurl.service.ts
│  ├─ run.service.ts    export.service.ts  search.service.ts  webhook.service.ts
├─ internal/                  // service-to-service (SYNC_INTERNAL_TOKEN / mTLS)
│  └─ authorize-board.ts  projection-callback.ts
└─ ws/                        // event stream to the client (run/job/unfurl events)
   └─ events.ts               // WebSocket at /events, per-user channel
```

**Rule:** a tRPC procedure and a REST controller for the same capability must both delegate to the
same `services/*` function (ADR-006). Controllers contain validation, mapping and nothing else.

### 2.2 Boot sequence

```text
1. loadEnv()                 zod-validated; fatal on error
2. initLogger(), initMetrics(), initTracing()
3. prisma.$connect(); assertMigrationsApplied(); assertRlsEnabled()   // R11
4. redis connect; s3 headBucket
5. registerPlugins(); registerRoutes(); generateOpenApi()
6. listen(API_PORT); mark ready
7. SIGTERM → stop accepting (readyz=false) → drain ≤ 20 s → close pools → exit 0
```

### 2.3 Context and middleware chain

```ts
export interface AuthContext {
  txId: string; // uuid v7, echoed in the `x-nexus-tx` response header
  user: { id: string; email: string } | null;
  session: { id: string; expiresAt: Date } | null;
  orgId: string | null; // resolved per request from input or the active org cookie
  role: OrgRole | null; // 'owner'|'admin'|'member'|'guest'
  ip: string;
  userAgent: string;
  flags: Flags;
}
```

Chain: `requestId → trace → session → orgResolve(+RLS set_config) → rateLimit → zod input →
authz(procedure) → handler → response mapping → error mapper`.

tRPC procedure builders:

```ts
export const publicProcedure = t.procedure.use(logging);
export const authedProcedure = publicProcedure.use(requireSession);
export const orgProcedure = authedProcedure.use(requireOrg('member'));
export const projectProcedure = orgProcedure.use(requireProject('viewer')); // reads input.projectId
export const editorProcedure = orgProcedure.use(requireProject('editor'));
export const adminProcedure = orgProcedure.use(requireOrg('admin'));
```

`requireProject(role)` resolves `projectId` from `input.projectId` or from `input.boardId`
(board→project lookup, cached 30 s in Redis keyed by board id, invalidated on board move/delete).

### 2.4 Shared schema fragments

```ts
export const Id = z.string().uuid();
export const Cursor = z.string().max(256); // opaque, base64url
export const Page = z.object({
  cursor: Cursor.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export const PageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: Cursor.nullable(),
    total: z.number().int().optional(),
  });
export const Timestamps = z.object({ createdAt: z.date(), updatedAt: z.date() });
export const Provenance = z.object({
  source: z.string().max(2048), // url or 'user'
  tool: z.string().max(64).nullable(),
  runId: Id.nullable(),
  observedAt: z.date(),
  confidence: z.number().min(0).max(1).nullable(),
  rawArtifactKey: z.string().max(512).nullable(),
});
export const IdempotencyKey = z.string().min(8).max(128);
```

---

## 3. tRPC router inventory

Naming: `router.procedure`. Every mutation that can be replayed offline accepts
`idempotencyKey`. All outputs are DTOs, never Prisma models.

### 3.1 `auth`

```ts
auth.session: query() => z.object({
  user: z.object({ id: Id, email: z.string().email(), name: z.string(), avatarUrl: z.string().url().nullable() }).nullable(),
  orgs: z.array(z.object({ id: Id, name: z.string(), slug: z.string(), role: OrgRoleSchema })),
  activeOrgId: Id.nullable(),
  flags: z.record(z.union([z.boolean(), z.number(), z.string()])),
  serverTime: z.date(),
  limits: z.object({ maxUploadBytes: z.number(), maxBoardElements: z.number(), aiTokensRemaining: z.number() }),
})

auth.switchOrg:   mutation({ orgId: Id }) => z.object({ ok: z.literal(true) })
auth.updateProfile: mutation({ name: z.string().min(1).max(80).optional(),
                               avatarFileId: Id.nullable().optional(),
                               prefs: UserPrefsSchema.partial().optional() }) => UserDto
auth.listSessions: query() => z.array(z.object({ id: Id, createdAt: z.date(), lastSeenAt: z.date(),
                               ip: z.string(), userAgent: z.string(), current: z.boolean() }))
auth.revokeSession: mutation({ sessionId: Id }) => Ok
auth.createApiToken: mutation({ name: z.string().max(64), scopes: z.array(ScopeSchema).min(1),
                                expiresInDays: z.number().int().min(1).max(365).default(90) })
  => z.object({ id: Id, token: z.string() })    // plaintext returned once; stored as argon2id hash
auth.revokeApiToken: mutation({ id: Id }) => Ok
```

Login/logout/OAuth callbacks are Better-Auth HTTP routes at `/auth/*`, not tRPC.

The mount point is `/auth`, **not** Better-Auth's default `/api/auth`. Both sides must say so:
the server passes `basePath: '/auth'` (`apps/api/src/auth/index.ts`) and the browser client passes
`basePath: AUTH_BASE_PATH` (`apps/web/src/lib/auth.ts`). If only one side is configured, every
auth call 404s and the UI surfaces it as a generic "couldn't reach the server" banner — the
failure mode that broke e2e J01 in CI run 32071533040.

**Signup creates the personal org.** Authorization is org-scoped end to end (`orgProcedure`), so a
user without a membership is authenticated but allowed nothing: every project/board call answers
`FORBIDDEN`. A Better-Auth `databaseHooks.user.create.after` hook calls
`ensurePersonalOrg()` (`apps/api/src/auth/personal-org.ts`), which creates one organization named
after the user plus an `owner` membership, inside the same request as the account. The helper is
idempotent (an existing membership wins), so replays and OAuth account linking never create a
second org. Multi-org invites and `auth.switchOrg` still arrive in P7.

### 3.2 `projects`

```ts
const ProjectDto = z.object({ id: Id, orgId: Id, name: z.string(), description: z.string().nullable(),
  color: z.string().regex(/^--project-[a-z]+$/), icon: z.string().max(32).nullable(),
  archivedAt: z.date().nullable(), boardCount: z.number().int(), memberCount: z.number().int() }).merge(Timestamps);

projects.list:   query({ includeArchived: z.boolean().default(false) }).merge(Page) => PageOf(ProjectDto)
projects.get:    query({ projectId: Id }) => ProjectDto
projects.create: mutation({ name: z.string().min(1).max(120), description: z.string().max(2000).optional(),
                            color: z.string().optional(), icon: z.string().optional(),
                            template: z.enum(['empty','osint-investigation','research']).default('empty'),
                            idempotencyKey: IdempotencyKey.optional() }) => ProjectDto
projects.update: mutation({ projectId: Id, patch: ProjectPatchSchema }) => ProjectDto
projects.archive / projects.restore: mutation({ projectId: Id }) => ProjectDto
projects.delete: mutation({ projectId: Id, confirmName: z.string() }) => Ok   // soft delete, purge after 30 d
projects.members.list:   query({ projectId: Id }) => z.array(MemberDto)
projects.members.invite: mutation({ projectId: Id, email: z.string().email(), role: ProjectRoleSchema }) => InviteDto
projects.members.setRole: mutation({ projectId: Id, userId: Id, role: ProjectRoleSchema }) => MemberDto
projects.members.remove:  mutation({ projectId: Id, userId: Id }) => Ok
```

`confirmName` must equal the project name — destructive-action confirmation (`N8`).

### 3.3 `boards`

```ts
const BoardDto = z.object({ id: Id, projectId: Id, name: z.string(), description: z.string().nullable(),
  visibility: z.enum(['project','private']), elementCount: z.number().int(),
  docVersion: z.number().int(), projectedVersion: z.number().int(),
  thumbnailKey: z.string().nullable(), lastOpenedAt: z.date().nullable() }).merge(Timestamps);

boards.list: query({ projectId: Id, q: z.string().max(120).optional(),
                     sort: z.enum(['recent','name','created']).default('recent') }).merge(Page) => PageOf(BoardDto)
boards.get:  query({ boardId: Id }) => BoardDto
boards.create: mutation({ projectId: Id, name: z.string().min(1).max(120),
                          copyFromBoardId: Id.optional(), idempotencyKey: IdempotencyKey.optional() }) => BoardDto
boards.update: mutation({ boardId: Id, patch: z.object({ name: z.string().min(1).max(120).optional(),
                          description: z.string().max(4000).nullable().optional(),
                          visibility: z.enum(['project','private']).optional() }) }) => BoardDto
boards.duplicate: mutation({ boardId: Id, name: z.string().optional() }) => BoardDto
boards.delete:    mutation({ boardId: Id }) => Ok                          // soft, undo window 30 d
boards.snapshots.list: query({ boardId: Id }).merge(Page) => PageOf(z.object({
  version: z.number().int(), createdAt: z.date(), bytes: z.number().int(),
  kind: z.enum(['incremental','checkpoint']), label: z.string().nullable() }))
boards.snapshots.restore: mutation({ boardId: Id, version: z.number().int(),
                                     mode: z.enum(['new-board','in-place']).default('new-board') }) => BoardDto
boards.export: mutation({ boardId: Id, format: z.enum(['json-v1','markdown','pdf','png','archive']),
                          options: ExportOptionsSchema.optional() }) => z.object({ exportId: Id })
boards.import: mutation({ projectId: Id, format: z.literal('json-v1'),
                          fileId: Id, mode: z.enum(['new-board','merge']).default('new-board'),
                          targetBoardId: Id.optional() }) => z.object({ boardId: Id, proposalId: Id.nullable() })
boards.presence: query({ boardId: Id }) => z.array(z.object({ userId: Id, name: z.string(),
                          color: z.string(), lastSeenAt: z.date() }))
```

`boards.import` in `merge` mode produces a **Proposal**, never a direct write (`N4`).

### 3.4 `nodes` — bulk operations on the projection

The canvas never writes nodes through tRPC (writes go through the Y.Doc, `02_ARCHITECTURE.md` §4.2).
This router serves list/table/search views, plugins, and server-side bulk operations that are
converted into proposals.

```ts
const NodeDto = z.object({
  id: Id, boardId: Id, kind: NodeKindSchema, title: z.string(), summary: z.string().nullable(),
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  data: z.record(z.unknown()),               // validated per-kind by packages/domain
  tags: z.array(z.string()), groupId: Id.nullable(),
  provenance: Provenance, docVersion: z.number().int(),
}).merge(Timestamps);

nodes.list: query({ boardId: Id, kind: z.array(NodeKindSchema).optional(),
                    tag: z.array(z.string()).optional(), groupId: Id.nullable().optional(),
                    updatedAfter: z.date().optional(),
                    sort: z.enum(['created','updated','title','degree']).default('updated') }).merge(Page)
  => PageOf(NodeDto)
nodes.get:      query({ nodeId: Id }) => NodeDto
nodes.getMany:  query({ ids: z.array(Id).max(500) }) => z.array(NodeDto)
nodes.neighbors: query({ nodeId: Id, depth: z.number().int().min(1).max(4).default(1),
                         direction: z.enum(['out','in','both']).default('both'),
                         edgeTypes: z.array(EdgeTypeSchema).optional(), limit: z.number().int().max(2000).default(500) })
  => z.object({ nodes: z.array(NodeDto), edges: z.array(EdgeDto) })     // recursive CTE, depth-capped
nodes.bulkPropose: mutation({
  boardId: Id,
  ops: z.array(z.discriminatedUnion('op', [
    z.object({ op: z.literal('create'), kind: NodeKindSchema, data: z.record(z.unknown()),
               x: z.number().optional(), y: z.number().optional(), provenance: Provenance }),
    z.object({ op: z.literal('update'), nodeId: Id, patch: z.record(z.unknown()) }),
    z.object({ op: z.literal('delete'), nodeId: Id }),
    z.object({ op: z.literal('tag'),   nodeId: Id, add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() }),
    z.object({ op: z.literal('link'),  fromId: Id, toId: Id, type: EdgeTypeSchema, label: z.string().max(120).optional() }),
  ])).min(1).max(2000),
  title: z.string().max(120),
  autoAcceptIfTrusted: z.boolean().default(false),   // still creates the proposal record (ADR-014)
  idempotencyKey: IdempotencyKey.optional(),
}) => z.object({ proposalId: Id, itemCount: z.number().int(), warnings: z.array(z.string()) })
nodes.stats: query({ boardId: Id }) => z.object({
  total: z.number().int(), byKind: z.record(z.number().int()),
  edgeTotal: z.number().int(), orphans: z.number().int(), untagged: z.number().int() })
```

`edges` are read through `nodes.neighbors` and `search`; there is no separate write router because
edge mutation follows the same proposal/Y.Doc rules.

### 3.5 `files`

```ts
files.presign: mutation({
  boardId: Id.optional(), projectId: Id,
  filename: z.string().min(1).max(255),
  declaredMime: z.string().max(255),
  bytes: z.number().int().min(1).max(2_147_483_648),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),      // enables dedupe short-circuit
  idempotencyKey: IdempotencyKey.optional(),
}) => z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('existing'), fileId: Id, file: FileDto }),           // hash hit, no upload
  z.object({ mode: z.literal('single'), fileId: Id, url: z.string().url(),
             headers: z.record(z.string()), expiresAt: z.date() }),
  z.object({ mode: z.literal('multipart'), fileId: Id, uploadId: z.string(),
             partSize: z.number().int(), parts: z.array(z.object({ partNumber: z.number().int(), url: z.string().url() })) }),
])
files.complete: mutation({ fileId: Id, parts: z.array(z.object({ partNumber: z.number().int(), etag: z.string() })).optional() })
  => FileDto                                    // triggers sniffing + scan + derivative jobs
files.get:    query({ fileId: Id }) => FileDto
files.download: query({ fileId: Id, variant: z.enum(['original','thumb','preview']).default('original') })
  => z.object({ url: z.string().url(), expiresAt: z.date(), filename: z.string(), bytes: z.number().int() })
files.delete: mutation({ fileId: Id }) => Ok    // marks deleted; blob GC'd by maintenance (§13.2)
files.list:   query({ projectId: Id, kind: z.array(FileKindSchema).optional() }).merge(Page) => PageOf(FileDto)

const FileDto = z.object({ id: Id, projectId: Id, filename: z.string(), bytes: z.number().int(),
  mime: z.string(), kind: FileKindSchema, sha256: z.string(),
  state: z.enum(['pending','scanning','ready','failed','quarantined']),
  failure: z.object({ code: z.string(), message: z.string() }).nullable(),
  variants: z.object({ thumb: z.string().nullable(), preview: z.string().nullable(),
                       pageCount: z.number().int().nullable() }),
  width: z.number().int().nullable(), height: z.number().int().nullable(),
}).merge(Timestamps);
```

### 3.6 `unfurl`

```ts
unfurl.request: mutation({ url: z.string().url().max(2048), boardId: Id, nodeId: Id,
                           force: z.boolean().default(false), screenshot: z.boolean().default(true),
                           idempotencyKey: IdempotencyKey.optional() })
  => z.discriminatedUnion('status', [
       z.object({ status: z.literal('ready'), meta: UnfurlMetaSchema }),        // cache hit
       z.object({ status: z.literal('queued'), jobId: z.string(), etaMs: z.number().int() }),
       z.object({ status: z.literal('blocked'), code: z.enum(['PRIVATE_RANGE','SCHEME','DENYLIST','ROBOTS','TOO_LARGE']),
                  userMessage: z.string() }),
     ])
unfurl.get:  query({ url: z.string().url() }) => UnfurlMetaSchema.nullable()
unfurl.batch: mutation({ urls: z.array(z.string().url()).min(1).max(50), boardId: Id })
  => z.array(z.object({ url: z.string(), status: z.enum(['ready','queued','blocked']), meta: UnfurlMetaSchema.nullable() }))

export const UnfurlMetaSchema = z.object({
  url: z.string().url(), finalUrl: z.string().url(), canonicalUrl: z.string().url().nullable(),
  status: z.number().int(), contentType: z.string().nullable(),
  title: z.string().max(300).nullable(), description: z.string().max(1200).nullable(),
  siteName: z.string().max(200).nullable(), author: z.string().max(200).nullable(),
  publishedAt: z.date().nullable(), lang: z.string().max(16).nullable(),
  faviconFileId: Id.nullable(), imageFileId: Id.nullable(), screenshotFileId: Id.nullable(),
  themeColor: z.string().nullable(),
  provider: z.enum(['opengraph','oembed','html','headers','fallback']),
  oembed: z.object({ type: z.string(), html: z.string().nullable(), width: z.number().nullable(),
                     height: z.number().nullable() }).nullable(),
  readingTimeSec: z.number().int().nullable(),
  fetchedAt: z.date(), ttlSec: z.number().int(),
  warnings: z.array(z.string()),
});
```

### 3.7 `search`

```ts
search.query: query({
  scope: z.discriminatedUnion('type', [
    z.object({ type: z.literal('org') }),
    z.object({ type: z.literal('project'), projectId: Id }),
    z.object({ type: z.literal('board'), boardId: Id }),
  ]),
  q: z.string().min(1).max(200),
  mode: z.enum(['keyword','semantic','hybrid']).default('hybrid'),
  filters: z.object({
    kind: z.array(NodeKindSchema).optional(), tags: z.array(z.string()).optional(),
    createdAfter: z.date().optional(), createdBefore: z.date().optional(),
    tool: z.array(z.string()).optional(), minConfidence: z.number().min(0).max(1).optional(),
    hasFile: z.boolean().optional(),
  }).default({}),
}).merge(Page) => PageOf(z.object({
  nodeId: Id, boardId: Id, boardName: z.string(), kind: NodeKindSchema,
  title: z.string(), snippet: z.string(),                 // ts_headline, HTML-escaped, <mark> only
  score: z.number(), matchedBy: z.array(z.enum(['title','body','tag','url','semantic'])),
}))
search.suggest: query({ q: z.string().min(1).max(80), scope: SearchScope, limit: z.number().int().max(20).default(8) })
  => z.array(z.object({ type: z.enum(['node','board','project','tag','command']), id: z.string(),
                        label: z.string(), sublabel: z.string().nullable(), score: z.number() }))
search.recent: query({ limit: z.number().int().max(20).default(10) }) => z.array(RecentItemDto)
search.saved.list / save / delete: saved queries with the same filter object
```

Hybrid ranking: `score = 0.6 * ts_rank_cd(fts, query) + 0.4 * (1 - cosine_distance(embedding, q_vec))`,
computed with a `UNION ALL` of the two candidate sets (each capped at 200) and re-ranked in SQL.
Semantic legs are skipped when `search.semantic` is off or no embedding exists yet.

### 3.8 `tags`

```ts
tags.list: query({ projectId: Id, q: z.string().max(64).optional() }) =>
  z.array(z.object({ name: z.string(), color: z.string().nullable(), count: z.number().int() }))
tags.rename: mutation({ projectId: Id, from: z.string(), to: z.string() })
  => z.object({ proposalId: Id, affected: z.number().int() })      // rename is a proposal (N4/N8)
tags.setColor: mutation({ projectId: Id, name: z.string(), color: z.string().nullable() }) => Ok
tags.merge: mutation({ projectId: Id, sources: z.array(z.string()).min(1), target: z.string() })
  => z.object({ proposalId: Id, affected: z.number().int() })
tags.delete: mutation({ projectId: Id, name: z.string() }) => z.object({ proposalId: Id, affected: z.number().int() })
```

### 3.9 `integrations`

```ts
const IntegrationDto = z.object({
  id: z.string(),                       // 'github' | 'sherlock' | 'spiderfoot' | 'plugin:<id>'
  version: z.string(), displayName: z.string(), description: z.string(),
  category: z.enum(['code','identity','infrastructure','content','custom']),
  inputSchema: z.record(z.unknown()),   // JSON Schema derived from the manifest zod schema
  outputKinds: z.array(NodeKindSchema),
  requiresCredential: z.boolean(), credentialConfigured: z.boolean(),
  enabled: z.boolean(), health: z.enum(['ok','degraded','unavailable']),
  imageDigest: z.string().nullable(), lastHealthCheckAt: z.date().nullable(),
  limits: z.object({ timeoutMs: z.number().int(), concurrency: z.number().int(), costUnits: z.number() }),
});

integrations.list:   query({}) => z.array(IntegrationDto)
integrations.get:    query({ integrationId: z.string() }) => IntegrationDto
integrations.setEnabled: adminProcedure.mutation({ integrationId: z.string(), enabled: z.boolean() }) => IntegrationDto
integrations.credentials.set: adminProcedure.mutation({ integrationId: z.string(),
  values: z.record(z.string().max(4096)) }) => Ok      // encrypted at rest (15_SECURITY.md §5), never returned
integrations.credentials.clear: adminProcedure.mutation({ integrationId: z.string() }) => Ok
integrations.validate: mutation({ integrationId: z.string(), input: z.record(z.unknown()) })
  => z.object({ ok: z.boolean(), errors: z.array(z.object({ path: z.string(), message: z.string() })),
                estimatedDurationMs: z.number().int(), costUnits: z.number() })
integrations.health: adminProcedure.query({}) => z.array(z.object({ id: z.string(),
  health: z.enum(['ok','degraded','unavailable']), digestPinned: z.string().nullable(),
  digestUpstream: z.string().nullable(), lastRunAt: z.date().nullable(), failureRate24h: z.number() }))
```

Manifest semantics, sandbox flags and the adapter contracts are in `10_INTEGRATIONS.md`;
Sherlock and SpiderFoot specifics in `13_SHERLOCK.md` and `12_SPIDERFOOT.md` (including the
low-upstream-activity posture recorded in `02_ARCHITECTURE.md` ADR-011).

### 3.10 `runs`

```ts
const RunDto = z.object({
  id: Id, orgId: Id, boardId: Id, integrationId: z.string(), integrationVersion: z.string(),
  status: z.enum(['queued','starting','running','parsing','succeeded','failed','timeout','cancelled']),
  input: z.record(z.unknown()), progress: z.number().min(0).max(1).nullable(),
  startedAt: z.date().nullable(), finishedAt: z.date().nullable(), durationMs: z.number().int().nullable(),
  exitCode: z.number().int().nullable(),
  error: z.object({ class: z.string(), code: z.string(), userMessage: z.string() }).nullable(),
  proposalId: Id.nullable(),
  counts: z.object({ entities: z.number().int(), nodes: z.number().int(), edges: z.number().int() }).nullable(),
  artifactKeys: z.array(z.string()), costUnits: z.number(), triggeredBy: Id,
}).merge(Timestamps);

runs.start: editorProcedure.mutation({ integrationId: z.string(), boardId: Id,
  input: z.record(z.unknown()),                 // validated against the manifest input schema
  sourceNodeId: Id.optional(),                  // provenance anchor
  idempotencyKey: IdempotencyKey.optional() }) => z.object({ runId: Id })
runs.get:    query({ runId: Id }) => RunDto
runs.list:   query({ boardId: Id.optional(), integrationId: z.string().optional(),
                     status: z.array(RunStatusSchema).optional() }).merge(Page) => PageOf(RunDto)
runs.cancel: mutation({ runId: Id }) => RunDto                 // SIGTERM then SIGKILL after 5 s
runs.logs:   query({ runId: Id, cursor: Cursor.optional(), limit: z.number().int().max(1000).default(200) })
  => z.object({ lines: z.array(z.object({ ts: z.date(), stream: z.enum(['stdout','stderr','system']),
                text: z.string() })), nextCursor: Cursor.nullable() })
runs.artifact: query({ runId: Id, key: z.string() }) => z.object({ url: z.string().url(), expiresAt: z.date() })
runs.rerun:  mutation({ runId: Id, overrides: z.record(z.unknown()).optional() }) => z.object({ runId: Id })
```

Live updates are delivered on the `/events` WebSocket as `run:progress` / `run:done` messages
(§5.6), not by polling.

### 3.11 `ai`

```ts
ai.capabilities: query({}) => z.object({ enabled: z.boolean(), model: z.string(),
  features: z.array(z.enum(['summarize','explain','suggestLinks','dedupe','cluster','investigationSummary','askBoard'])),
  budget: z.object({ tokensUsed: z.number(), tokensLimit: z.number(), resetAt: z.date() }) })

ai.summarize: mutation({ boardId: Id, nodeIds: z.array(Id).min(1).max(50),
                         style: z.enum(['brief','detailed','bullets']).default('brief') })
  => z.object({ jobId: z.string() })
ai.explain:   mutation({ boardId: Id, targetId: Id, targetType: z.enum(['node','edge','group']) })
  => z.object({ jobId: z.string() })
ai.suggestLinks: mutation({ boardId: Id, scope: z.discriminatedUnion('type', [
    z.object({ type: z.literal('board') }),
    z.object({ type: z.literal('selection'), nodeIds: z.array(Id).max(200) }),
  ]), maxSuggestions: z.number().int().max(100).default(25) }) => z.object({ jobId: z.string() })
ai.dedupe:  mutation({ boardId: Id, threshold: z.number().min(0.5).max(1).default(0.86) }) => z.object({ jobId: z.string() })
ai.cluster: mutation({ boardId: Id, targetClusters: z.number().int().min(2).max(30).optional() }) => z.object({ jobId: z.string() })
ai.investigationSummary: mutation({ boardId: Id, audience: z.enum(['analyst','executive']).default('analyst') })
  => z.object({ jobId: z.string() })
ai.askBoard: mutation({ boardId: Id, question: z.string().min(3).max(1000) }) => z.object({ jobId: z.string() })

proposals.get:    query({ proposalId: Id }) => ProposalDto
proposals.list:   query({ boardId: Id, status: z.array(ProposalStatusSchema).optional() }).merge(Page) => PageOf(ProposalDto)
proposals.accept: editorProcedure.mutation({ proposalId: Id, itemIds: z.array(Id).min(1) })
  => ProposalDto                              // marks accepted; the CLIENT applies to the Y.Doc (N4, §4.2 of 02)
proposals.reject: mutation({ proposalId: Id, itemIds: z.array(Id).optional(), reason: z.string().max(500).optional() }) => ProposalDto
```

`ai.*` returns a `jobId`; results arrive as `ai:done { proposalId }` on `/events`. All AI output is
zod-validated before it becomes a proposal; invalid items are dropped and counted in
`nexus_ai_schema_reject_total`.

### 3.12 `exports`

```ts
exports.create: mutation({ boardId: Id, format: z.enum(['json-v1','markdown','pdf','png','archive']),
  options: z.object({
    includeProvenance: z.boolean().default(true), includeRunLogs: z.boolean().default(false),
    includeFiles: z.boolean().default(true), nodeIds: z.array(Id).optional(),
    pageSize: z.enum(['A4','Letter']).default('A4'),
    theme: z.enum(['dark','light']).default('light'),          // print defaults to light
    redact: z.array(z.enum(['emails','ips','credentials'])).default([]),
  }).default({}), idempotencyKey: IdempotencyKey.optional() }) => z.object({ exportId: Id })
exports.get:  query({ exportId: Id }) => ExportDto
exports.list: query({ boardId: Id.optional() }).merge(Page) => PageOf(ExportDto)
exports.download: query({ exportId: Id }) => z.object({ url: z.string().url(), expiresAt: z.date() })
exports.delete: mutation({ exportId: Id }) => Ok
```

### 3.13 `admin`

```ts
admin.org.get / admin.org.update({ name, slug, settings: OrgSettingsSchema })
admin.members.list / invite / setRole / remove / listInvites / revokeInvite
admin.usage: query({ from: z.date(), to: z.date() }) => z.object({
  storageBytes: z.number(), aiTokens: z.number(), runs: z.number(), runMinutes: z.number(),
  activeUsers: z.number(), boards: z.number() })
admin.audit.list: query({ actorId: Id.optional(), action: z.string().optional(),
  from: z.date().optional(), to: z.date().optional() }).merge(Page) => PageOf(AuditDto)
admin.flags.list / admin.flags.set({ key, scope, value, rollout })    // owner role only
admin.webhooks.list / create / update / delete / test / deliveries
admin.jobs.overview: query({}) => z.array(z.object({ queue: z.string(), waiting: z.number(),
  active: z.number(), delayed: z.number(), failed: z.number(), oldestWaitMs: z.number() }))
admin.jobs.retryDead: mutation({ queue: z.string(), jobIds: z.array(z.string()).max(500) }) => Ok
admin.projection.status: query({ boardId: Id.optional() }) => z.array(z.object({
  boardId: Id, docVersion: z.number(), projectedVersion: z.number(), lagSeconds: z.number(),
  projectorVersion: z.number(), lastError: z.string().nullable() }))
admin.projection.replay: mutation({ boardId: Id, dryRun: z.boolean().default(true) })
  => z.object({ inserted: z.number(), updated: z.number(), deleted: z.number() })
```

Every `admin.*` call writes an audit row: `{actor, action, target, before, after, ip, txId}`.

---

## 4. Public REST / OpenAPI surface

### 4.1 Principles

- Base path `/api/v1`. The version is in the path; `v1` is stable for the life of the major
  release. Breaking changes ship as `/api/v2` with ≥ 6 months of `v1` overlap and a
  `Sunset` response header on the deprecated version.
- Authentication: `Authorization: Bearer <api-token>` (scoped tokens from `auth.createApiToken`)
  or a session cookie for same-origin browser calls. Tokens are `nxs_` + 32 random bytes base62,
  stored argon2id-hashed.
- Scopes: `boards:read`, `boards:write`, `nodes:read`, `nodes:propose`, `files:read`,
  `files:write`, `runs:read`, `runs:start`, `search:read`, `exports:read`, `admin:read`.
  A token never exceeds the granting user's own permissions (intersection is evaluated per request).
- Content type `application/json; charset=utf-8`. Timestamps are RFC 3339 UTC. IDs are UUIDv7.
- Errors use RFC 9457 `application/problem+json`:

```json
{
  "type": "https://nexus.dev/errors/UNFURL_PRIVATE_RANGE",
  "title": "URL blocked",
  "status": 422,
  "detail": "The URL resolves to a private IP range.",
  "code": "UNFURL_PRIVATE_RANGE",
  "class": "blocked",
  "txId": "018f…"
}
```

### 4.2 Endpoints

| Method | Path                                        | Scope           | Notes                                                         |
| ------ | ------------------------------------------- | --------------- | ------------------------------------------------------------- |
| GET    | `/api/v1/openapi.json`                      | none            | generated from the zod schemas                                |
| GET    | `/api/v1/me`                                | any             | token identity + scopes + org                                 |
| GET    | `/api/v1/projects`                          | `boards:read`   | cursor paginated                                              |
| GET    | `/api/v1/projects/{id}/boards`              | `boards:read`   |                                                               |
| POST   | `/api/v1/projects/{id}/boards`              | `boards:write`  | `Idempotency-Key` header honored                              |
| GET    | `/api/v1/boards/{id}`                       | `boards:read`   |                                                               |
| GET    | `/api/v1/boards/{id}/nodes`                 | `nodes:read`    | filters mirror `nodes.list`                                   |
| GET    | `/api/v1/boards/{id}/edges`                 | `nodes:read`    |                                                               |
| GET    | `/api/v1/boards/{id}/export?format=json-v1` | `exports:read`  | 302 to a presigned URL, or 202 + `Location` for async formats |
| POST   | `/api/v1/boards/{id}/proposals`             | `nodes:propose` | body = `nodes.bulkPropose` ops                                |
| GET    | `/api/v1/nodes/{id}`                        | `nodes:read`    |                                                               |
| GET    | `/api/v1/nodes/{id}/neighbors?depth=2`      | `nodes:read`    | depth ≤ 4                                                     |
| POST   | `/api/v1/files`                             | `files:write`   | returns presign payload                                       |
| POST   | `/api/v1/files/{id}/complete`               | `files:write`   |                                                               |
| GET    | `/api/v1/files/{id}/content`                | `files:read`    | 302 to presigned GET                                          |
| POST   | `/api/v1/runs`                              | `runs:start`    | `Idempotency-Key` required                                    |
| GET    | `/api/v1/runs/{id}`                         | `runs:read`     |                                                               |
| GET    | `/api/v1/runs/{id}/logs`                    | `runs:read`     | `text/event-stream` when `Accept` says so                     |
| GET    | `/api/v1/search?q=…&scope=project:{id}`     | `search:read`   |                                                               |
| GET    | `/api/v1/integrations`                      | `runs:read`     |                                                               |
| POST   | `/api/v1/webhooks/test`                     | `admin:read`    |                                                               |

`Idempotency-Key`: stored for 24 h with the request-body hash; a replay with the same key and body
returns the original response and `Idempotency-Replayed: true`; the same key with a different body
returns `409` `IDEMPOTENCY_KEY_REUSED`.

### 4.3 Outgoing webhooks

Events: `board.created`, `board.deleted`, `node.created`, `node.updated`, `node.deleted`,
`run.succeeded`, `run.failed`, `proposal.created`, `proposal.accepted`, `export.ready`,
`file.quarantined`.

Delivery: `POST` JSON with headers `X-Nexus-Event`, `X-Nexus-Delivery` (uuid), `X-Nexus-Timestamp`,
`X-Nexus-Signature: v1=<hex hmac-sha256 of "<timestamp>.<body>">` using the endpoint secret.
Receivers must reject timestamps older than 300 s. Node events are **debounced per node at 5 s**
and coalesced so a drag does not emit 60 webhooks.

Retries: 8 attempts at 5 s, 30 s, 2 m, 10 m, 30 m, 2 h, 6 h, 12 h with jitter; a 2xx or 410 ends the
sequence (410 disables the endpoint). After the last failure the endpoint is marked `failing` and an
admin notification is created. Delivery history is retained 7 days
(`admin.webhooks.deliveries`).

### 4.4 Rate limits

| Bucket                            | Limit      | Window     | Scope                   |
| --------------------------------- | ---------- | ---------- | ----------------------- |
| REST default                      | 600 req    | 1 min      | token                   |
| REST writes (`POST/PATCH/DELETE`) | 120 req    | 1 min      | token                   |
| `/api/v1/runs` POST               | 20 req     | 1 min      | org                     |
| `/api/v1/search`                  | 60 req     | 1 min      | token                   |
| tRPC default                      | 1200 calls | 1 min      | session                 |
| `unfurl.request`                  | 120        | 1 min      | org                     |
| `files.presign`                   | 60         | 1 min      | user                    |
| `ai.*`                            | 30         | 1 min      | org (plus token budget) |
| Auth endpoints                    | 10         | 5 min      | IP + email              |
| WS `/events` connections          | 5          | concurrent | user                    |

Algorithm: sliding-window counters in Redis (`INCR` + `PEXPIRE`) with a token-bucket refill for
burst tolerance (`burst = limit / 4`). Responses carry `RateLimit-Limit`, `RateLimit-Remaining`,
`RateLimit-Reset`; 429 carries `Retry-After` in seconds. Limits are per-plan overridable in
`org.settings.rateLimits`.

---

## 5. `apps/sync` — realtime server

### 5.1 Configuration

```ts
const server = Server.configure({
  port: env.SYNC_PORT, address: '0.0.0.0', name: `sync-${hostname()}`,
  timeout: 30_000,                       // idle socket
  debounce: 2_000, maxDebounce: 10_000,  // store() cadence → projection cadence
  quiet: true,
  extensions: [
    new Redis({ host: …, prefix: 'nexus:hp' }),           // multi-pod fanout + awareness
    new Database({ fetch, store }),                        // §5.3
    new Logger({ onLoadDocument: false }),
    new ThrottleExtension({ throttle: 200, banTime: 60 }), // messages/s per socket
  ],
  async onAuthenticate({ token, documentName, requestHeaders, connection }) { … },  // §5.2
  async onBeforeHandleMessage({ context, documentName, update }) { … },             // §5.4
  async onStoreDocument(...) { /* handled by Database ext */ },
  async onDisconnect({ documentName, context }) { recordPresenceLeave(...) },
});
```

Room naming: `board:<uuid>`. One room per board; a client with three boards open holds three rooms
over one WebSocket connection (Hocuspocus multiplexes).

### 5.2 Auth hook

```ts
onAuthenticate: async ({ token, documentName }) => {
  const boardId = parseRoom(documentName); // throws → 4401 close
  const res = await internalApi.authorizeBoard({ token, boardId }); // HTTP, SYNC_INTERNAL_TOKEN
  if (!res.allow) throw new Error('forbidden'); // Hocuspocus closes with 4403
  return {
    userId: res.userId,
    orgId: res.orgId,
    role: res.role,
    displayName: res.name,
    color: res.color,
  }; // becomes connection.context
};
```

`authorizeBoard` results are cached in Redis for 30 s (`authz:board:<boardId>:<sessionId>`) and
invalidated on membership or visibility change. Session expiry mid-room is enforced by a 60 s
re-check timer; on failure the room connection is closed with code 4401 and the client shows
"Session expired — reconnecting after sign-in" while keeping local edits.

### 5.3 Persistence hook and projection

```ts
fetch: async ({ documentName }) => {
  const b = parseRoom(documentName);
  const snap = await db.snapshots.latest(b);           // checkpoint + incrementals merged
  return snap?.state ?? null;                          // null → fresh doc
},
store: async ({ documentName, state, document }) => {
  const boardId = parseRoom(documentName);
  await db.$transaction(async (tx) => {
    const version = await db.boards.bumpDocVersion(tx, boardId);
    await db.snapshots.write(tx, boardId, version, state, kindFor(version));  // checkpoint every 200 / 15 min
    await projectBoard(tx, boardId, document, version);      // 02_ARCHITECTURE.md §7.3
  }, { timeout: 15_000 });
}
```

Failure handling: a projection failure rolls back the whole transaction (binary included) and the
update is retried on the next debounce; three consecutive failures push a `projection:repair` job
and raise `nexus_projection_failures_total`. Because the CRDT state is retained in the room memory
and in every connected client's IndexedDB, no data is lost by a rollback (G3).

### 5.4 Write authorization and guards

- `viewer` role: `onBeforeHandleMessage` rejects `SyncStep2`/`Update` messages (awareness allowed).
- Update size cap: 4 MB per message; larger disconnects with `4413` and the client splits
  (it never legitimately produces such an update outside a paste of thousands of nodes).
- Board element cap: the projector counts elements; above 100 000 the room switches to read-only
  and emits a `board:limit` awareness event (`02_ARCHITECTURE.md` §8.3).
- Awareness payload cap: 8 KB per client; larger fields are dropped.

### 5.5 Presence and awareness fields

```ts
interface AwarenessState {
  user: { id: string; name: string; color: string; avatarUrl: string | null };
  cursor: { x: number; y: number } | null; // board coordinates, throttled to 20 Hz
  viewport: { x: number; y: number; w: number; h: number } | null; // throttled to 4 Hz
  selection: string[]; // capped at 50 ids
  activity: 'idle' | 'editing' | 'dragging' | 'running';
}
```

### 5.6 `/events` channel (on `apps/api`, not sync)

Server→client push for non-document facts: `unfurl:done`, `file:ready`, `file:failed`,
`run:progress`, `run:done`, `ai:done`, `export:done`, `quota:warning`, `flag:changed`.
Transport: WebSocket at `/events` with a fallback to SSE at `/events/sse`. One connection per tab;
messages are JSON `{ type, txId, payload }`; the server replays the last 50 events for the user on
reconnect using a Redis stream (`events:<userId>`, `MAXLEN ~ 200`, TTL 1 h) so a brief disconnect
does not lose a completion notice.

---

## 6. Unfurl service

### 6.1 Pipeline

```text
request(url)
 1. normalize:      trim, add scheme if missing (https), strip fragment, lowercase host,
                    punycode host, remove known tracking params (utm_*, fbclid, gclid, ref, _ga)
 2. validate:       zod url; scheme ∈ {http, https}; length ≤ 2048; no credentials in authority
 3. cache lookup:   redis GET unfurl:v3:<sha256(normalizedUrl)>  → hit? return (§6.4)
 4. policy:         org denylist/allowlist; acceptable-use check (15_SECURITY.md §9)
 5. ssrf guard:     §6.2 — resolve, filter, pin
 6. fetch:          GET with pinned IP, Host header preserved, timeout 8 s connect / 15 s total,
                    max 5 MB body, max 3 redirects (each re-validated by the guard),
                    UA "NexusBot/1.0 (+https://<host>/bot)", Accept-Encoding gzip/br
 7. classify:       content-type → html | image | pdf | json | other
 8. extract:        §6.3 (html) | image probe | pdf first-page + metadata | json → pretty preview
 9. derivatives:    favicon fetch, OG image fetch (≤ 5 MB), screenshot (§6.5)
10. persist:        files rows for derivatives; unfurl_cache row; redis cache with TTL (§6.4)
11. emit:           unfurl:done on /events → client writes into the Y.Doc (client-side, N4-safe)
```

### 6.2 SSRF guard (`packages/platform/src/ssrf.ts`) — implements `N7`

```ts
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeResponse> {
  const u = new URL(rawUrl);
  assert(['http:', 'https:'].includes(u.protocol), 'SCHEME');
  assert(!u.username && !u.password, 'CREDENTIALS_IN_URL');
  assert(!isDenylistedHost(u.hostname), 'DENYLIST');            // metadata hosts, *.internal, .local
  const addrs = await dns.lookup(u.hostname, { all: true });
  const allowed = addrs.filter(a => !isPrivate(a.address));     // see ranges below
  assert(allowed.length > 0, 'PRIVATE_RANGE');
  const pinned = allowed[0].address;                            // PIN the resolved address
  // connect to `pinned` while sending Host: u.hostname and SNI = u.hostname  → no DNS rebinding
  const res = await undiciRequest(u, { dispatcher: pinnedDispatcher(pinned), maxRedirections: 0, … });
  if (isRedirect(res.statusCode)) {
    assert(opts.redirectsLeft > 0, 'TOO_MANY_REDIRECTS');       // cap 3
    return safeFetch(resolveLocation(u, res.headers.location), { ...opts, redirectsLeft: opts.redirectsLeft - 1 });
  }
  return streamWithByteCap(res, opts.maxBytes);                 // aborts past the cap
}
```

Blocked ranges: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16` (incl. `169.254.169.254`),
`172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, `224/4`, `240/4`, and IPv6 `::1/128`,
`fc00::/7`, `fe80::/10`, `::ffff:0:0/96` mapped equivalents. In production all worker egress also
goes through `EGRESS_PROXY_URL` whose allowlist is the second line of defense. The hostile-URL
corpus test lives in `packages/platform/test/ssrf.corpus.ts` (≥ 120 cases including decimal IPs,
IPv6 mapping, rebinding servers, redirect chains, `0x7f.1`, and `http://[::ffff:127.0.0.1]`).

### 6.3 HTML metadata extraction

Order of precedence per field (first non-empty wins):

| Field       | Sources in order                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| title       | `og:title` → `twitter:title` → `<title>` → `h1` → hostname                                                                                    |
| description | `og:description` → `twitter:description` → `meta[name=description]` → first ≥ 120-char paragraph (truncated at 1200 chars on a word boundary) |
| image       | `og:image:secure_url` → `og:image` → `twitter:image` → `link[rel=image_src]` → largest `<img>` ≥ 200×200 in the first 40 KB                   |
| siteName    | `og:site_name` → `application-name` → registrable domain                                                                                      |
| author      | `article:author` → `meta[name=author]` → JSON-LD `author.name`                                                                                |
| publishedAt | `article:published_time` → JSON-LD `datePublished` → `meta[name=date]` (parsed to UTC, rejected if > 1 day in the future)                     |
| canonical   | `link[rel=canonical]` (must be same-registrable-domain, else ignored)                                                                         |
| lang        | `<html lang>` → `og:locale`                                                                                                                   |
| favicon     | `link[rel~=icon]` largest declared size → `/favicon.ico` → domain fallback glyph                                                              |
| themeColor  | `meta[name=theme-color]`                                                                                                                      |

Parsing uses a streaming HTML parser over the first 512 KB only (metadata is in `<head>`);
`<meta>` content is HTML-entity decoded and then treated as untrusted text (never rendered as HTML).
oEmbed: if the host matches the discovered `link[type="application/json+oembed"]`, fetch that
endpoint through the same guard (budget: one extra request, 5 s) and store `oembed.html` **without
rendering it** — the client renders a click-to-load placeholder only for hosts on the org's oEmbed
allowlist (default: none), because arbitrary oEmbed HTML is untrusted third-party markup.

Non-HTML handling: `image/*` → probe dimensions, store as an image node preview;
`application/pdf` → first page rendered as the preview, page count and PDF metadata extracted;
`application/json` → pretty-printed first 32 KB as the preview body;
everything else → headers-only metadata (`provider: 'headers'`).

### 6.4 Caching keys and TTLs

| Cache          | Key                                          | Store                 | TTL                                                            | Invalidation                                |
| -------------- | -------------------------------------------- | --------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| Unfurl result  | `unfurl:v3:<sha256(normalizedUrl)>`          | Redis (JSON, ≤ 32 KB) | 24 h (2xx), 1 h (3xx-final), 15 min (4xx), 5 min (5xx/timeout) | `force:true` bypasses and rewrites          |
| Unfurl durable | `unfurl_cache` table row keyed by `url_hash` | Postgres              | 30 d, refreshed on hit                                         | nightly GC of rows unused 90 d              |
| Screenshot     | `shot:<sha256(finalUrl)>:<vw>x<vh>:<theme>`  | S3 + row              | 7 d                                                            | `force`, or content-hash change of the HTML |
| robots.txt     | `robots:<origin>`                            | Redis                 | 12 h                                                           | —                                           |
| Favicon        | `favicon:<registrableDomain>`                | S3 + row              | 30 d                                                           | —                                           |
| DNS decision   | not cached                                   | —                     | —                                                              | re-resolved every fetch (rebinding defense) |

Cache is keyed on the **normalized** URL; the response records `finalUrl` so redirect chains are
visible to the analyst (provenance requirement).

### 6.5 Screenshot capture

- A shared headless Chromium pool in `apps/worker` (`BROWSER_POOL_SIZE`, default 6 in prod),
  Playwright, one **incognito browser context per capture**, destroyed after use.
- Context settings: viewport 1280×800 @ dpr 2, `javascript: enabled`, `bypassCSP: false`,
  no persistent storage, `permissions: []`, offline-blocked resource types
  (`media`, `websocket`, `eventsource`), request interception routing every request through the
  SSRF guard's allow decision, hard navigation timeout 20 s, total capture budget 30 s.
- Output: full-page capped at 4 000 px height, WebP quality 82, plus a 640×400 thumbnail.
- Robots: if `robots.txt` disallows our UA for the path, no screenshot is taken; metadata from the
  server response is still stored, and `warnings` contains `robots_disallowed_screenshot`.
- Crash/OOM: the context is discarded, the pool worker is recycled after 50 captures or 10 min,
  and the job fails with `class:'upstream', code:'SCREENSHOT_FAILED'` (2 retries, §6.7).

### 6.6 Politeness

Per registrable domain: max 2 concurrent requests and 1 request per 500 ms (Redis token bucket
`polite:<domain>`); respect `Retry-After`; obey `robots.txt` for both fetch and screenshot;
`Crawl-delay` is honored up to a 10 s cap (beyond that the job fails fast with
`code:'ROBOTS_CRAWL_DELAY_TOO_HIGH'`). NEXUS never follows links found in the page — unfurl is
single-URL, never a crawler.

### 6.7 Failure modes

| Condition                   | Code                   | Class    | User message                                                                           | Retry                        |
| --------------------------- | ---------------------- | -------- | -------------------------------------------------------------------------------------- | ---------------------------- |
| Private/loopback resolution | `UNFURL_PRIVATE_RANGE` | blocked  | "This address is on a private network, so it can't be previewed."                      | no                           |
| Non-http scheme             | `UNFURL_SCHEME`        | blocked  | "Only http and https links can be previewed."                                          | no                           |
| robots disallow (page)      | `UNFURL_ROBOTS`        | blocked  | "This site asks not to be fetched automatically. The link is saved without a preview." | no                           |
| > 3 redirects               | `UNFURL_REDIRECTS`     | upstream | "The link redirects too many times."                                                   | no                           |
| Body > 5 MB                 | `UNFURL_TOO_LARGE`     | upstream | "The page is too large to preview."                                                    | no                           |
| Timeout                     | `UNFURL_TIMEOUT`       | timeout  | "The site didn't respond in time."                                                     | 3×                           |
| 4xx                         | `UNFURL_HTTP_4XX`      | upstream | "The site returned {status}."                                                          | no                           |
| 5xx                         | `UNFURL_HTTP_5XX`      | upstream | "The site is having problems."                                                         | 3×                           |
| TLS failure                 | `UNFURL_TLS`           | upstream | "The site's certificate couldn't be verified."                                         | no                           |
| Parse produced nothing      | `UNFURL_EMPTY`         | upstream | "We couldn't read anything useful from this page."                                     | no (metadata: hostname only) |
| Breaker open                | `BREAKER_OPEN`         | upstream | "This site is temporarily unavailable to us."                                          | delayed                      |

Every failure still yields a usable node: URL, hostname, and a domain-letter glyph — the card is
never blank (`03_UX.md` §12).

---

## 7. File pipeline

### 7.1 Upload

1. `files.presign` — validates filename, declared MIME, size against caps (§7.3) and the org
   storage quota; creates a `files` row (`state='pending'`) with a server-generated key
   `org/{orgId}/proj/{projectId}/{fileId}/{slug(filename)}`.
   If `sha256` is supplied and a `ready` file with the same hash exists in the org, returns
   `mode:'existing'` — a zero-byte upload (content-addressed dedupe).
2. Client uploads directly to S3: single PUT below 8 MB, otherwise multipart with 8 MB parts and
   parallelism 4. Presigned URLs expire in 900 s and are bound to key, method and content-length.
3. `files.complete` — server does `HEAD` (and `CompleteMultipartUpload`), verifies the byte count
   matches the presigned declaration, then enqueues `file:process`.

The client mirrors every uploaded blob into **OPFS** keyed by `sha256` so the file is available
offline and for instant re-render; OPFS mirror is capped at 2 GB per origin with LRU eviction, and
eviction is safe because S3 remains authoritative.

### 7.2 Server-side processing (`file:process` job)

```text
1. stream first 64 KB → magic-byte sniffing (file-type); NEVER trust client MIME
2. mismatch policy: sniffed type wins; if sniffed ∉ allowed set → state='failed',
   code='FILE_TYPE_NOT_ALLOWED' and the blob is deleted immediately
3. archive/polyglot checks: reject files whose sniff and extension disagree across type families
   (e.g. .png that sniffs as text/html), reject zip bombs (see §7.3)
4. virus scan hook: POST the object key to VIRUS_SCAN_URL (ClamAV REST in the reference deployment)
   · absent config → skip with a startup warning in prod, hard error when NEXUS_ENV=prod and
     FILES_REQUIRE_SCAN=true
   · verdict 'infected' → state='quarantined', blob moved to quarantine/ prefix, audit + webhook
   · scan timeout 60 s → state='failed', code='FILE_SCAN_TIMEOUT', retry 2×
5. compute sha256 (streamed), fill width/height/pageCount metadata
6. enqueue derivative generation (§7.4)
7. state='ready'; emit file:ready on /events
```

### 7.3 Size and type caps

| Kind        | Sniffed types                   | Max size | Notes                                                                                                                         |
| ----------- | ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| image       | png, jpeg, webp, gif, avif, svg | 25 MB    | SVG is sanitized (DOMPurify, server-side) and served with `Content-Disposition: attachment` + CSP sandbox                     |
| pdf         | application/pdf                 | 100 MB   | preview = first page; text layer extracted up to 2 MB for search                                                              |
| document    | docx, odt, rtf, txt, md         | 50 MB    | docx → HTML preview via mammoth; text extracted for search                                                                    |
| spreadsheet | xlsx, ods, csv, tsv             | 50 MB    | csv/tsv preview = first 200 rows × 30 cols; delimiter sniffed                                                                 |
| data        | json, ndjson, xml, yaml         | 25 MB    | json preview = pretty first 32 KB; schema outline for objects                                                                 |
| archive     | zip, tar, gz, 7z                | 200 MB   | listing only: max 5 000 entries, max 10 MB of listing, reject ratio > 100:1 or depth > 8 (zip-bomb guard); no auto-extraction |
| video/audio | mp4, webm, mp3, wav             | 500 MB   | poster frame at 1 s; no transcoding                                                                                           |
| other       | any allowed                     | 100 MB   | generic icon, no preview                                                                                                      |

Global hard cap: 2 GB per file (schema-level), plan quota per org. Disallowed by default:
executables (`application/x-*executable`, `.dll`, `.so`), `.iso`, `.dmg`, Office macro formats
(`.docm`, `.xlsm`) unless `files.allowMacroDocs` is enabled for the org.

### 7.4 Derivatives

| Input       | thumb (WebP)                | preview                                            | Tool                      |
| ----------- | --------------------------- | -------------------------------------------------- | ------------------------- |
| image       | 320×320 cover, q80          | 1600 px long edge, q82                             | sharp                     |
| pdf         | page 1 → 320×420            | page 1 → 1600 px + page count                      | pdfium/mupdf render       |
| docx        | first page render → 320×420 | HTML (sanitized)                                   | mammoth + headless render |
| csv/tsv     | table glyph                 | JSON of first 200×30 cells + inferred column types | fast-csv                  |
| json/ndjson | code glyph                  | pretty first 32 KB + top-level key outline         | streaming parser          |
| zip/tar     | archive glyph               | entry tree (name, size, mtime), depth ≤ 8          | yauzl/tar-stream          |
| video       | poster frame 320×180        | poster 1280×720 + duration                         | ffmpeg                    |
| audio       | waveform 320×80             | waveform PNG + duration                            | ffmpeg                    |

Derivatives are written to `…/{fileId}/thumb.webp` and `…/{fileId}/preview.*`; failures are
non-fatal (`variants.thumb = null`, the UI falls back to a kind glyph) and are recorded in
`nexus_file_derivative_fail_total{kind}`.

### 7.5 Access and lifecycle

Downloads always go through a presigned GET with a 900 s TTL and
`response-content-disposition=attachment` for anything not image/pdf. Deleting a file marks
`deleted_at`; blobs are GC'd by `maintenance:blob-gc` after 7 days **only if** no node in any board
references the hash (§13.2).

---

## 8. Job queue design

### 8.1 Queues

| Queue          | Jobs                                           | Priority | Concurrency/worker  | Attempts            | Backoff       | TTL    |
| -------------- | ---------------------------------------------- | -------- | ------------------- | ------------------- | ------------- | ------ |
| `unfurl`       | `unfurl:fetch`                                 | 5        | 8                   | 3                   | exp 1 s ×4    | 30 min |
| `screenshot`   | `unfurl:screenshot`                            | 6        | `BROWSER_POOL_SIZE` | 2                   | exp 2 s ×5    | 30 min |
| `files`        | `file:process`, `file:derivative`, `file:scan` | 4        | 6                   | 3                   | exp 2 s ×3    | 2 h    |
| `integrations` | `integration:run`, `integration:parse`         | 3        | 4 (run) / 8 (parse) | 1 (run) / 2 (parse) | none / 5 s    | 2 h    |
| `ai`           | `ai:*`, `ai:embed`                             | 5        | 4                   | 3                   | exp 1 s ×5    | 1 h    |
| `exports`      | `export:build`                                 | 7        | 2                   | 2                   | exp 5 s ×6    | 6 h    |
| `projection`   | `projection:repair`, `projection:backfill`     | 2        | 2                   | 5                   | exp 100 ms ×5 | 24 h   |
| `webhooks`     | `webhook:deliver`                              | 8        | 16                  | 8                   | table §4.3    | 24 h   |
| `maintenance`  | §13                                            | 9        | 1                   | 2                   | fixed 60 s    | 24 h   |

Lower priority number = served first. Each queue group runs in its own worker deployment so a
screenshot storm cannot starve projection repair.

### 8.2 Job envelope

```ts
export const JobEnvelope = z.object({
  v: z.literal(1),
  txId: z.string(), // trace correlation, from the originating request
  orgId: Id,
  projectId: Id.nullable(),
  boardId: Id.nullable(),
  userId: Id.nullable(),
  idempotencyKey: z.string().max(128),
  enqueuedAt: z.number().int(),
  deadlineAt: z.number().int(), // job is dropped (not failed) if picked up after this
  payload: z.unknown(),
});
```

BullMQ `jobId` is set to `sha256(queue + ':' + idempotencyKey)` so re-enqueueing the same logical
work is a no-op while the job exists. `removeOnComplete: { age: 3600, count: 1000 }`,
`removeOnFail: { age: 604800 }`.

### 8.3 Failure handling

- Attempts exhausted → the job moves to the queue's dead-letter set (`<queue>:dead`, a separate
  BullMQ queue with no worker) with the last error serialized as a `NexusError`.
- `admin.jobs.retryDead` re-enqueues selected dead jobs with a fresh deadline.
- `nexus_job_dead_total{queue,code}` is alerted at > 10 in 15 min.
- Poison detection: three consecutive failures with the same `code` for the same `idempotencyKey`
  stop retrying immediately (no exponential burn).
- Worker crash → BullMQ stalled-job recovery after `lockDuration` (30 s, renewed every 15 s during
  long jobs; integration runs renew until the manifest timeout).

### 8.4 Idempotency

Every consumer must be safe under at-least-once delivery:

- `unfurl:fetch` — cache write is last-writer-wins on the same key; harmless.
- `file:process` — guarded by a state transition `pending → scanning` with `UPDATE … WHERE state='pending'`;
  a second delivery sees 0 rows updated and exits.
- `integration:run` — `runs` row has a unique `(org_id, idempotency_key)`; a duplicate returns the
  existing run and never spawns a second container.
- `ai:*` — a duplicate returns the existing proposal id.
- `export:build` — unique `(board_id, doc_version, format, options_hash)`; duplicates return the
  existing export.
- `webhook:deliver` — receivers deduplicate on `X-Nexus-Delivery`; we guarantee at-least-once.

---

## 9. Caching layers

| Layer    | Content                               | Store          | TTL                                             | Invalidation                                  |
| -------- | ------------------------------------- | -------------- | ----------------------------------------------- | --------------------------------------------- |
| CDN      | hashed JS/CSS/fonts                   | edge           | 1 y immutable                                   | content hash in filename                      |
| CDN      | `index.html`                          | edge           | no-store                                        | —                                             |
| HTTP     | `GET /api/v1/openapi.json`            | edge/browser   | 5 min                                           | build id                                      |
| Redis    | session → AuthContext                 | Redis          | 30 s                                            | on logout/role change (`authctx:<sessionId>`) |
| Redis    | board→project+ACL                     | Redis          | 30 s                                            | on membership/visibility change               |
| Redis    | flags per org                         | Redis          | 60 s                                            | pub/sub `flags:changed`                       |
| Redis    | unfurl results                        | Redis          | §6.4                                            | `force`                                       |
| Redis    | search suggest                        | Redis          | 60 s                                            | key includes scope+q prefix                   |
| Redis    | rate-limit counters                   | Redis          | window                                          | —                                             |
| Postgres | `unfurl_cache`, derivative rows       | Postgres       | 30 d                                            | GC job                                        |
| Process  | manifests, JSON Schemas, compiled zod | in-memory      | process lifetime                                | deploy                                        |
| Client   | tRPC query cache                      | memory         | per-query `staleTime` (list 30 s, detail 5 min) | mutation invalidation                         |
| Client   | Y.Doc + blobs                         | IndexedDB/OPFS | until eviction                                  | CRDT merge / LRU                              |

Rule: no cache may hold data across tenants under one key — every cache key includes `orgId`
whenever the value is tenant-scoped.

---

## 10. Pagination and cursoring

Keyset pagination only; `OFFSET` is banned in `packages/db` (lint-enforced together with the
mandatory `take`).

```ts
// cursor = base64url(JSON.stringify({ k: [sortValue, id], v: 1 }))
function buildCursorWhere(sort: SortSpec, cursor?: Cursor) {
  // SELECT … WHERE (sort_col, id) < ($1, $2) ORDER BY sort_col DESC, id DESC LIMIT $limit + 1
}
```

- `limit` default 50, max 200; the handler fetches `limit + 1` rows to compute `nextCursor` and
  never returns the extra row.
- `total` is returned only when cheap (`< 10 000` estimated rows via `pg_class.reltuples` check);
  otherwise it is omitted and the UI shows "50+".
- Every paginated query has a supporting composite index `(scope_col, sort_col DESC, id DESC)`
  listed in `08_DATA_MODEL.md` §6.
- Cursors are opaque and version-tagged; an unparsable or wrong-version cursor yields
  `validation` / `CURSOR_INVALID` rather than silently restarting from page 1.
- Deep graph traversals (`nodes.neighbors`) are not cursored; they are depth- and count-capped
  (depth ≤ 4, ≤ 2 000 rows) and use a recursive CTE with a visited set.

---

## 11. Rate limiting implementation

```ts
// packages/platform/src/ratelimit.ts
export async function consume(rule: RuleId, key: string, cost = 1): Promise<RateVerdict> {
  // Lua script, single round trip:
  //   window key: rl:{rule}:{key}:{floor(now/windowMs)}
  //   INCRBY cost; if first write PEXPIRE windowMs*2
  //   read previous window for the sliding estimate:
  //   estimate = prevCount * (1 - elapsedRatio) + currCount
  //   allowed = estimate <= limit + burst
}
```

Keys are hashed (`sha256(rule|key)[0..16]`) to bound key size. Failure mode: if Redis is
unavailable, the limiter **fails open for reads and fails closed for writes and runs**, logs
`nexus_ratelimit_degraded_total`, and the API stays available for viewing. Per-rule configuration
lives in `packages/platform/src/ratelimit.rules.ts` and is overridable per org plan.

---

## 12. Logging, metrics, tracing conventions

### 12.1 Logging

pino JSON, one line per event, base fields `{ service, env, version, txId, orgId?, userId?, boardId? }`.
Levels: `error` (actionable), `warn` (degraded but handled), `info` (state changes: run started,
export ready, member invited), `debug` (dev only). **Never logged:** credentials, API tokens,
cookies, AI prompt bodies (only hashes and token counts), file contents, full HTML of fetched pages.
URL logging truncates query strings to their parameter names. Request logs are sampled at 100% for
non-2xx and 10% for 2xx above 5 ms.

### 12.2 Metric catalogue (concrete names)

```text
# API
nexus_http_requests_total{service,route,method,code}
nexus_http_request_duration_ms{service,route,method}       histogram [1,5,10,25,50,100,250,500,1000,2500,5000]
nexus_trpc_calls_total{procedure,ok}
nexus_trpc_duration_ms{procedure}
nexus_ratelimit_block_total{rule}
nexus_ratelimit_degraded_total
nexus_auth_failures_total{reason}
nexus_idempotency_replays_total{route}

# Sync
nexus_sync_connections{service}                             gauge
nexus_sync_rooms_active                                      gauge
nexus_sync_messages_total{type}
nexus_sync_update_bytes                                      histogram
nexus_sync_store_duration_ms
nexus_sync_auth_denied_total{reason}

# Projection
nexus_projection_lag_seconds                                 histogram
nexus_projection_rows_total{op="insert|update|delete"}
nexus_projection_duration_ms{mode="full|delta"}
nexus_projection_failures_total{code}
nexus_projection_mismatch_total
nexus_snapshot_bytes{kind="incremental|checkpoint"}

# Jobs
nexus_job_enqueued_total{queue,name}
nexus_job_wait_ms{queue}
nexus_job_duration_ms{queue,name}
nexus_job_failed_total{queue,name,code}
nexus_job_dead_total{queue,name,code}
nexus_queue_depth{queue,state="waiting|active|delayed|failed"}   gauge

# Unfurl / files
nexus_unfurl_total{result="ready|blocked|failed|cached"}
nexus_unfurl_duration_ms{stage="fetch|parse|screenshot"}
nexus_unfurl_bytes_fetched
nexus_ssrf_block_total{reason}
nexus_browser_pool_size / nexus_browser_pool_busy              gauge
nexus_file_processed_total{kind,result}
nexus_file_bytes_total{kind}
nexus_file_scan_duration_ms
nexus_file_quarantined_total
nexus_file_derivative_fail_total{kind}

# Runs / AI
nexus_run_total{integration,status}
nexus_run_duration_ms{integration}
nexus_runner_container_kills_total{reason="timeout|oom|policy|cancel"}
nexus_ai_tokens_total{model,dir="in|out"}
nexus_ai_cost_usd_total{org}
nexus_ai_latency_ms{feature}
nexus_ai_schema_reject_total{feature}
nexus_proposal_items_total{origin="ai|tool|import",status="accepted|rejected|pending"}

# Platform
nexus_build_info{version,commit}                              gauge=1
nexus_db_pool_in_use{service}                                 gauge
nexus_webhook_delivery_total{event,code}
nexus_storage_bytes{org}                                      gauge (hourly)
```

### 12.3 Tracing

OpenTelemetry, W3C `traceparent`. The client generates the root span for user-initiated actions and
sends `traceparent` on tRPC/REST calls; `txId` equals the trace id's low 64 bits rendered as uuidv7
for human search. Instrumented: HTTP server/client, Prisma, Redis, BullMQ (producer and consumer
linked via job attributes), S3 SDK, Playwright captures, runner exec. Sampling: 100% of errors and
of `runs`/`export`/`projection` spans, 5% of routine requests, plus a forced-sample header for
support (`x-nexus-debug-trace: 1`, admin-only).

---

## 13. Background maintenance jobs

| Job                                   | Schedule                    | Action                                                                                                                                                                         | Safety                                                                      |
| ------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `maintenance:snapshot-checkpoint`     | every 15 min                | for boards with > 200 incremental snapshots since the last checkpoint, write a full checkpoint and delete superseded incrementals older than 24 h                              | never deletes the newest checkpoint or anything < 24 h old                  |
| `maintenance:snapshot-retention`      | daily 03:10 UTC             | keep all snapshots ≤ 7 d, hourly ≤ 30 d, daily ≤ 180 d, monthly ≤ 2 y                                                                                                          | dry-run count logged first; deletions audited                               |
| `maintenance:blob-gc`                 | hourly                      | delete S3 objects whose `files` row is `deleted_at < now() - 7 d` **and** whose `sha256` is unreferenced by any node in any board (projection query)                           | two-phase: mark `gc_pending`, delete on the next pass if still unreferenced |
| `maintenance:orphan-blob-scan`        | weekly Sun 04:00            | list bucket prefixes, find objects with no `files` row older than 24 h, move to `orphans/` for 30 d then delete                                                                | never deletes directly from the live prefix                                 |
| `maintenance:stale-run-cleanup`       | every 5 min                 | runs stuck in `starting`/`running` past `timeoutMs + 60 s` → mark `timeout`, ask the runner to kill the container, keep artifacts                                              | idempotent state transition guarded by `WHERE status IN (…)`                |
| `maintenance:run-artifact-retention`  | daily 03:30                 | delete run artifacts older than 90 d (org-configurable 7–365 d) unless referenced by a node's `rawArtifactKey`                                                                 | reference check via projection                                              |
| `maintenance:projection-audit`        | daily 02:00                 | recompute the projection hash for a 2% board sample; mismatch → enqueue `projection:repair`                                                                                    | read-only unless mismatched                                                 |
| `maintenance:projection-backfill`     | continuous, low priority    | boards where `projected_version < doc_version` for > 60 s                                                                                                                      | rate-limited to 4 concurrent                                                |
| `maintenance:unfurl-cache-gc`         | daily 03:50                 | delete `unfurl_cache` rows unused for 90 d and their derivative blobs                                                                                                          | reference check against nodes                                               |
| `maintenance:session-gc`              | hourly                      | delete expired sessions and used/expired invites                                                                                                                               | —                                                                           |
| `maintenance:soft-delete-purge`       | daily 04:30                 | hard-delete projects/boards soft-deleted > 30 d ago, cascading to nodes/edges/files                                                                                            | audit row per purge; a final export bundle is written to `archive/` first   |
| `maintenance:integration-health`      | every 6 h                   | pull the upstream tag digest for each pinned integration image, compare with the manifest, update `integrations.health`; mark `degraded` when the pinned digest is unreachable | never auto-updates a digest (ADR-011)                                       |
| `maintenance:quota-recalc`            | hourly                      | recompute per-org storage/AI usage into `org_usage`                                                                                                                            | —                                                                           |
| `maintenance:embedding-backfill`      | continuous, low priority    | embed nodes whose `text_hash` changed and lack a current embedding                                                                                                             | budget-capped per org                                                       |
| `maintenance:webhook-endpoint-health` | daily                       | disable endpoints failing for 7 consecutive days, notify admins                                                                                                                | —                                                                           |
| `maintenance:board-thumbnail`         | on demand, debounced 10 min | render a board thumbnail for board lists                                                                                                                                       | skipped for boards > 20 000 elements                                        |

All maintenance jobs take a Redis lock (`lock:maint:<name>`, TTL = 2× expected duration) so only one
instance runs cluster-wide, log a structured summary (`{scanned, changed, skipped, durationMs}`),
and support `--dry-run` through `admin.jobs` for operators.

---

## 14. Open risks

| #   | Risk                                                                                        | Impact                                             | Mitigation / trigger                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Headless browser pool is the most expensive and least stable worker component               | Screenshot loss, worker OOM                        | Isolated queue and deployment, context-per-capture, recycle every 50 captures, `capture.screenshots` kill-switch, metadata-only is a complete fallback      |
| R2  | Unfurl of hostile pages (huge DOM, redirect loops, decompression bombs)                     | Worker resource exhaustion                         | 5 MB byte cap enforced at the stream, 512 KB parse window, 3-redirect cap, 15 s total budget, per-domain politeness bucket                                  |
| R3  | Projection transaction contention on very active boards (store every 2 s × many boards)     | Sync store latency, lag alert                      | Delta-mode projector above 20 000 elements, `maxDebounce` 10 s, per-board advisory lock, connection pool separated from API                                 |
| R4  | tRPC and REST drift (ADR-006)                                                               | Plugin breakage                                    | Both call `services/*`; contract parity tests in `18_TESTING.md` §7; OpenAPI generated from the same zod schemas                                            |
| R5  | Virus scanning is optional in self-host deployments                                         | Malware distribution through a shared board        | `FILES_REQUIRE_SCAN` defaults to true in prod; without a scanner configured, uploads of executable-adjacent kinds are rejected outright                     |
| R6  | At-least-once job delivery combined with a non-idempotent future consumer                   | Duplicate side effects (double run, double charge) | Idempotency is a review checklist item for every new consumer; `runs` has a DB-level unique key; new queues require an idempotency note in the PR           |
| R7  | Rate limiter fails open for reads when Redis is down                                        | Load amplification during an incident              | Fail-closed for writes/runs, per-pod in-process fallback limiter (1/10 of the global limit), alert on `nexus_ratelimit_degraded_total`                      |
| R8  | Idempotency-key store growth and 24 h replay window mismatch with long offline periods      | Duplicate operations after > 24 h offline          | Offline pending intents carry a client-generated key; the client also checks for an existing entity by key before re-submitting (`02_ARCHITECTURE.md` §5.5) |
| R9  | Blob GC deleting a blob still referenced by an unprojected board version                    | Broken file reference                              | Two-phase GC, 7-day quarantine, reference check against the projection **and** a `projected_version >= doc_version` precondition per board                  |
| R10 | Archive listing and docx/pdf rendering pull heavy native dependencies into the worker image | Image size, CVE surface                            | Derivative generation isolated in its own worker deployment with a minimal image; failure is non-fatal (glyph fallback)                                     |
| R11 | Search hybrid ranking weights (0.6/0.4) are unvalidated against real corpora                | Poor result quality                                | Weights are configuration (`search.rankWeights`), an offline relevance harness with a labelled fixture set runs in CI (`18_TESTING.md` §8)                  |
