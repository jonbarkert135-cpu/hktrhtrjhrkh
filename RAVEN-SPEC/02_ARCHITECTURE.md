# Raven — 02 ARCHITECTURE

## Layer contracts, module boundaries, runtime topology, key sequences

**Scope**
This document is the structural contract of Raven. It fixes the runtime topology (which process
owns what), the nine internal layers and their public API surfaces, the monorepo package graph and
its machine-enforced dependency rules, the read and write data-flow paths, the canonical sequence
diagrams, the projection design (Yjs binary → Postgres rows), multi-tenancy, error taxonomy,
feature flags, configuration matrix, observability signals and the ADR register.
It refines `00_MASTER.md` §2, §5 and §6 and never overrides them. Endpoint-level detail lives in
`09_BACKEND.md`; renderer internals in `05_CANVAS_ENGINE.md`; schemas in `08_DATA_MODEL.md`.

---

## 1. Runtime topology

### 1.1 Process map

```text
                                   ┌───────────────────────────────┐
                                   │  Browser (one tab = one user  │
                                   │  session, N open boards)      │
                                   │                               │
                                   │  apps/web  (React 19 + Vite)  │
                                   │   ├ UI Layer                  │
                                   │   ├ Canvas Engine (no React)  │
                                   │   ├ Domain Layer              │
                                   │   ├ Data Layer (Y.Doc)        │
                                   │   ├ Web Workers: edge-router, │
                                   │   │  layout, search-index     │
                                   │   └ Storage: IndexedDB + OPFS │
                                   └───┬───────────────┬───────────┘
                       WSS (Yjs sync)  │               │ HTTPS (tRPC batch, REST v1)
                                       │               │
              ┌────────────────────────▼──┐        ┌───▼────────────────────────────┐
              │ apps/sync                 │        │ apps/api                        │
              │ Hocuspocus 4              │        │ Fastify 5 (Node 22 LTS)         │
              │  · onAuthenticate hook    │        │  · tRPC v11 router (app client) │
              │  · awareness / presence   │        │  · REST + OpenAPI (plugins,     │
              │  · Redis extension fanout │        │    webhooks)                    │
              │  · Database ext:          │        │  · Better-Auth session verify   │
              │    store binary + project │        │  · zod validation at boundary   │
              │  · debounced snapshots    │        │  · enqueues BullMQ jobs         │
              └───┬───────────────┬───────┘        └───┬───────────────┬─────────────┘
                  │               │                    │               │
                  │               └──────┬─────────────┘               │
                  │                      │                             │
        ┌─────────▼───────┐   ┌──────────▼────────┐        ┌───────────▼───────────┐
        │ PostgreSQL 16   │   │ Redis 7           │        │ S3 / MinIO            │
        │ + pgvector      │   │ · BullMQ queues   │        │ · originals           │
        │ · projects/ACL  │   │ · Hocuspocus pub/ │        │ · thumbnails          │
        │ · nodes/edges   │   │   sub             │        │ · screenshots         │
        │   (projection)  │   │ · rate limits     │        │ · run artifacts       │
        │ · doc snapshots │   │ · unfurl cache    │        │ · export bundles      │
        │ · runs, audit   │   └──────────┬────────┘        └───────────▲───────────┘
        └─────────▲───────┘              │                             │
                  │                      │ consume                     │
                  │            ┌─────────▼──────────┐                  │
                  └────────────┤ apps/worker        ├──────────────────┘
                               │ BullMQ consumers   │
                               │ · unfurl           │
                               │ · thumbnail        │
                               │ · repo-analysis    │
                               │ · ai               │
                               │ · export           │
                               │ · maintenance      │
                               │ + headless browser │
                               │   pool (screenshot)│
                               └─────────┬──────────┘
                                         │ gRPC-less HTTP (internal, mTLS)
                               ┌─────────▼──────────┐        ┌────────────────────┐
                               │ apps/runner        │───────►│ egress proxy       │
                               │ manifest-driven    │  only  │ (allowlist, audit) │
                               │ container spawner  │  path  └─────────┬──────────┘
                               │ gVisor runtimeClass│                  │
                               └─────────┬──────────┘                  ▼
                                         │ spawns              public internet
                            ┌────────────▼─────────────┐
                            │ tool container (ephemeral)│
                            │ sherlock / spiderfoot /   │
                            │ github-analyzer …         │
                            │ --read-only --cap-drop ALL│
                            └───────────────────────────┘
```

### 1.2 Per-service responsibilities

| Service       | Owns                                                                                                                              | Must not                                                                                 | Scaling unit                                     | Statefulness                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| `apps/web`    | rendering, interaction, local document, offline durability, optimistic UX                                                         | contain business rules that the server must also enforce; write to Postgres directly     | CDN-served static bundle                         | IndexedDB + OPFS per origin   |
| `apps/sync`   | Y.Doc rooms, auth on room join, awareness, binary persistence, projection into Postgres, snapshot cadence                         | serve product APIs, run tools, call third-party services                                 | horizontal, Redis fanout, sticky not required    | in-memory doc per active room |
| `apps/api`    | request/response product surface (tRPC + REST), authn/z decisions, validation, job enqueue, presigned URLs, search queries, admin | hold WebSocket rooms, execute tools (`N5`), do long CPU work inline                      | horizontal, stateless                            | none (sessions in Postgres)   |
| `apps/worker` | asynchronous work: unfurl, screenshots, thumbnails, repo analysis, AI calls, exports, maintenance                                 | accept public inbound traffic; mutate Y.Doc directly                                     | horizontal per queue, concurrency per queue      | ephemeral tmp only            |
| `apps/runner` | manifest-driven sandboxed tool execution, artifact capture, resource enforcement                                                  | parse tool output into domain entities (that is `packages/integrations`), reach Postgres | horizontal, node-pinned to sandbox-capable hosts | ephemeral                     |
| Postgres      | durable truth for everything queryable + Yjs binary snapshots                                                                     | be bypassed by any service writing files as truth                                        | primary + read replica (P16)                     | stateful                      |
| Redis         | queues, pub/sub, rate limit counters, short-TTL caches                                                                            | hold anything whose loss is unrecoverable                                                | cluster/sentinel                                 | ephemeral-by-design           |
| S3/MinIO      | blobs: originals, derivatives, run artifacts, exports                                                                             | store metadata that is not also in Postgres                                              | provider                                         | stateful                      |

**Trust boundaries.** (1) browser ↔ api/sync: hostile, everything validated with zod;
(2) worker ↔ internet: hostile outbound, SSRF guard + egress proxy;
(3) runner ↔ tool container: fully hostile, container is treated as compromised by default;
(4) plugin code ↔ web app: hostile, see `17_PLUGIN_SDK.md`.

### 1.3 Why sync and api are separate processes

A Hocuspocus room holds an in-memory `Y.Doc` and long-lived sockets; API pods are killed and
replaced freely on deploy. Co-locating them would make every API deploy drop every live board
session and would couple API autoscaling (request-rate driven) to room memory (board-count driven).
Separation also satisfies `N5` structurally: the API image has no `child_process` usage and no
socket state to protect.

---

## 2. The nine layers

Layer numbering is stable and referenced by other documents. Layers 1–4 are client, 5–8 server,
9 is cross-cutting.

```text
L1 UI            L2 Canvas Engine   L3 Domain      L4 Data
L5 Transport/API L6 Persistence     L7 Execution   L8 Intelligence
L9 Platform (cross-cutting: config, auth, observability, flags, security)
```

### L1 — UI Layer

- **Owns:** React component tree, panels, inspector, command palette, dialogs, toasts, keyboard
  shortcut registry, theming, focus management, routing (`react-router` in `apps/web/src/routes`).
- **Must not:** contain graph algorithms, know Yjs types, perform network calls other than through
  L5 hooks, hardcode design values (tokens only, `04_DESIGN_SYSTEM.md` §2).
- **Public API surface:** none — it is a leaf. Nothing imports `apps/web/src/ui/**` except
  `apps/web`.
- **Package:** `apps/web/src/ui/**`, primitives from `packages/ui`.

### L2 — Canvas Engine

- **Owns:** camera, spatial index, viewport culling, LOD selection, canvas painting, DOM overlay
  mount/unmount scheduling, interaction FSM (idle/hover/marquee/drag/connect/pan/zoom), hit
  testing, rAF loop, edge routing worker protocol.
- **Must not:** import React, import Yjs, know that a node is a "GitHub repo", fetch anything.
- **Public API surface** (`packages/canvas-engine/src/index.ts`):

```ts
export interface SceneNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  kind: string; // opaque to the engine
  lod: 'glyph' | 'compact' | 'full'; // computed, but overridable
  selected: boolean;
  hidden: boolean;
  paint: PaintHints; // colors/labels resolved by L3, engine only draws
}
export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  route: RouteMode;
  waypoints?: Vec2[];
  paint: EdgePaintHints;
}
export interface CanvasEngine {
  mount(host: HTMLElement, opts: EngineOptions): void;
  destroy(): void;
  setScene(patch: ScenePatch): void; // diff-based, never full replace on hot paths
  camera: CameraController;
  hitTest(p: Vec2, opts?: HitOptions): HitResult | null;
  query(rect: Rect): string[]; // spatial index query
  on<E extends EngineEventName>(e: E, cb: (payload: EngineEvent[E]) => void): Unsubscribe;
  overlay: { visibleNodeIds(): string[]; onChange(cb: (ids: string[]) => void): Unsubscribe };
  stats(): { fps: number; drawnNodes: number; drawnEdges: number; lastFrameMs: number };
}
```

The engine **emits intents** (`node:dragEnd`, `edge:connectRequest`, `selection:change`) and never
mutates data. See `05_CANVAS_ENGINE.md` §3–§6.

### L3 — Domain Layer

- **Owns:** entity and edge type registry, zod schemas, provenance rules, proposal construction and
  application, selection semantics, graph algorithms (traversal, clustering, dedupe, layout inputs),
  export/import serialization (`JSON v1`), derived selectors from the document.
- **Must not:** import React, import the canvas engine, perform I/O, read `window`.
- **Public API surface** (`packages/domain/src/index.ts`):

```ts
export const NodeSchema: z.ZodType<NodeEntity>;
export const EdgeSchema: z.ZodType<EdgeEntity>;
export const BoardExportV1: z.ZodType<BoardExport>;
export function buildScene(
  doc: DocSnapshot,
  view: ViewState,
): { nodes: SceneNode[]; edges: SceneEdge[] };
export function applyProposal(doc: DocHandle, p: Proposal, origin: Origin): ApplyResult; // only graph writer
export function planLayout(g: GraphView, algo: LayoutAlgo, opts: LayoutOpts): LayoutPlan;
export function detectDuplicates(g: GraphView, opts: DedupeOpts): DuplicateCluster[];
```

- **Invariant N4 enforcement:** `applyProposal` is the _only_ exported symbol that writes graph
  structure. ESLint rule `raven/no-direct-graph-write` forbids `ydoc.getMap('nodes').set(...)`
  outside `packages/domain/src/write/**`.

### L4 — Data Layer (client)

- **Owns:** `Y.Doc` lifecycle per board, `y-indexeddb` provider, OPFS blob cache, Hocuspocus
  provider, sync/connection status machine, tRPC client + query cache, optimistic mutation
  bookkeeping, awareness state publication.
- **Must not:** import the canvas engine (`00_MASTER.md` §5), interpret entity semantics, render.
- **Public API surface** (`apps/web/src/data/index.ts`):

```ts
export function openBoard(boardId: string): Promise<BoardHandle>;
export interface BoardHandle {
  doc: Y.Doc;
  undo: Y.UndoManager;
  status: Readable<SyncStatus>; // 'local' | 'saving' | 'saved' | 'offline' | 'error'
  awareness: Awareness;
  blobs: { get(hash: string): Promise<Blob | null>; put(hash: string, b: Blob): Promise<void> };
  close(): Promise<void>;
}
export const trpc: TRPCClient<AppRouter>;
```

### L5 — Transport / API

- **Owns:** tRPC router definitions and REST controllers, request validation, authz middleware,
  serialization, rate limiting, OpenAPI document generation, error mapping to the taxonomy in §8.
- **Must not:** contain business logic beyond orchestration; talk to third-party hosts directly
  (that is worker/runner); import Prisma models into the response type surface (map to DTOs).
- **Public surface:** `AppRouter` type exported from `apps/api/src/router/index.ts` and consumed by
  `apps/web` type-only; REST `/api/v1/**` described in `09_BACKEND.md` §5.

### L6 — Persistence

- **Owns:** Prisma schema and migrations, repositories, the projection engine, snapshot writer,
  blob store abstraction, search queries (FTS + pgvector), transaction boundaries.
- **Must not:** be imported by `apps/web`; leak SQL types past repository functions.
- **Public surface:** `packages/db` exports `prisma`, `repositories/*`, `projectBoardUpdate()`.

### L7 — Execution

- **Owns:** BullMQ queue definitions and consumers, the runner protocol, manifest resolution,
  sandbox policy application, artifact capture, run state machine.
- **Must not:** map raw tool output into domain entities inside `apps/runner` (parsers live in
  `packages/integrations`, executed in `apps/worker`); write to `nodes`/`edges` (it produces a
  Proposal instead — `N4`).
- **Public surface:** `packages/integrations` manifest + parser contracts (`10_INTEGRATIONS.md` §3).

### L8 — Intelligence

- **Owns:** `AIProvider` abstraction, prompt templates, embedding pipeline, proposal generation
  (summarize, link-suggest, dedupe, cluster, investigation summary), cost accounting and budgets.
- **Must not:** write to the graph (always a Proposal), be the only path to a feature (every AI
  feature degrades to a deterministic fallback or an explicit "unavailable" state).
- **Public surface:** `packages/domain/src/ai/types.ts` (`AIProvider`, `Proposal`), implementations
  in `apps/worker/src/ai/**`. See `14_AI_AGENT.md`.

### L9 — Platform (cross-cutting)

- **Owns:** configuration loading and validation, secrets access, Better-Auth setup, RBAC policy
  evaluation, feature flags, logging/metrics/tracing bootstrap, audit log writer, SSRF guard,
  health/readiness endpoints.
- **Must not:** depend on any of L1–L8 (it is the base of the dependency graph).
- **Public surface:** `packages/config` (build/tooling config) plus `packages/platform`
  (`env`, `logger`, `metrics`, `flags`, `authz`, `ssrf`) — runtime-only, never imported by
  `packages/canvas-engine` or `packages/domain`.

### 2.1 Layer contract matrix (may-import)

| from ↓ / to → | L1 UI | L2 Canvas | L3 Domain | L4 Data | L5 API    | L6 Persist | L7 Exec | L8 AI     | L9 Platform |
| ------------- | ----- | --------- | --------- | ------- | --------- | ---------- | ------- | --------- | ----------- |
| L1 UI         | —     | yes       | yes       | yes     | type-only | no         | no      | type-only | yes         |
| L2 Canvas     | no    | —         | no        | no      | no        | no         | no      | no        | no          |
| L3 Domain     | no    | no        | —         | no      | no        | no         | no      | types     | no          |
| L4 Data       | no    | **no**    | yes       | —       | yes       | no         | no      | no        | yes         |
| L5 API        | no    | no        | yes       | no      | —         | yes        | yes     | yes       | yes         |
| L6 Persist    | no    | no        | yes       | no      | no        | —          | no      | no        | yes         |
| L7 Exec       | no    | no        | yes       | no      | no        | yes        | —       | yes       | yes         |
| L8 AI         | no    | no        | yes       | no      | no        | yes        | no      | —         | yes         |
| L9 Platform   | no    | no        | no        | no      | no        | no         | no      | no        | —           |

`packages/canvas-engine` and `packages/domain` intentionally sit at the bottom with zero runtime
dependencies on anything internal except `packages/config` types — this is what makes them
testable in Node without a DOM and benchmarkable in isolation (`N1`).

---

## 3. Monorepo package graph and enforced rules

### 3.1 Graph

```text
                      packages/config  (tsconfig, eslint, vitest, tailwind preset)
                              ▲
        ┌─────────────────────┼──────────────────────────────┐
        │                     │                              │
 packages/canvas-engine  packages/domain ◄──────────── packages/integrations
        │                 ▲   ▲      ▲                        ▲
        │                 │   │      │                        │
        │        packages/ui│   │      └────── packages/plugin-sdk (types only)
        │                 │   │                                │
        └────────┬────────┘   │                                │
                 │            │                                │
             apps/web ────────┘                                │
                                                               │
 packages/platform ◄── apps/api ── apps/sync ── apps/worker ────┘
        ▲                 │           │            │
        └─────────────────┴───────────┴────────────┴── packages/db
                                                        ▲
                                                   apps/runner (platform only, no db)
```

Hard facts encoded above:

- `apps/runner` **cannot** import `packages/db` — a compromised tool must not reach a DB client.
- `packages/plugin-sdk` is types + a narrow host API; it never imports `apps/*`.
- `packages/ui` may import `packages/domain` **types only** (for prop typing), never its algorithms.

### 3.2 dependency-cruiser configuration sketch

`.dependency-cruiser.cjs` (run in CI, gate §6 of `00_MASTER.md` §8):

```js
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: '\\.d\\.ts$|^packages/config/' },
      to: {},
    },
    {
      name: 'engine-no-react',
      severity: 'error',
      from: { path: '^packages/canvas-engine/' },
      to: { path: 'node_modules/(react|react-dom|motion|framer-motion)' },
    },
    {
      name: 'engine-no-yjs',
      severity: 'error',
      from: { path: '^packages/canvas-engine/' },
      to: { path: 'node_modules/(yjs|y-)' },
    },
    {
      name: 'engine-isolated',
      severity: 'error',
      from: { path: '^packages/canvas-engine/' },
      to: { path: '^(apps|packages)/', pathNot: '^packages/(canvas-engine|config)/' },
    },
    {
      name: 'domain-pure',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: { path: '^(apps/|packages/(ui|canvas-engine|db|platform)/)' },
    },
    {
      name: 'domain-no-io',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: { path: 'node_modules/(axios|node-fetch|undici|fs|prisma|@prisma)' },
    },
    {
      name: 'data-not-canvas',
      severity: 'error',
      from: { path: '^apps/web/src/data/' },
      to: { path: '^packages/canvas-engine/' },
    },
    {
      name: 'ui-no-yjs',
      severity: 'error',
      from: { path: '^apps/web/src/ui/' },
      to: { path: 'node_modules/yjs' },
    },
    {
      name: 'api-no-child-process',
      severity: 'error', // N5
      from: { path: '^apps/api/' },
      to: { path: '^(child_process|node:child_process)$' },
    },
    {
      name: 'runner-no-db',
      severity: 'error',
      from: { path: '^apps/runner/' },
      to: { path: '^packages/db/|node_modules/(@prisma|prisma)' },
    },
    {
      name: 'plugin-sdk-pure',
      severity: 'error',
      from: { path: '^packages/plugin-sdk/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-cross-app',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'no-deep-package-import',
      severity: 'error',
      from: {},
      to: { path: '^packages/[^/]+/src/(?!index)', pathNot: '^packages/config/' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.base.json' },
    doNotFollow: { path: 'node_modules' },
    reporterOptions: { dot: { collapsePattern: '^(packages|apps)/[^/]+' } },
  },
};
```

CI runs `depcruise --config .dependency-cruiser.cjs apps packages --output-type err-long` and
publishes the `dot` graph as a build artifact for review.

### 3.3 Additional lint rules that encode architecture

| Rule                                  | Enforces                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `raven/no-direct-graph-write`         | N4 — Yjs graph maps mutated only inside `packages/domain/src/write/**`                           |
| `raven/no-hardcoded-design-value`     | `00_MASTER.md` §10.6 — bans hex colors, raw px in `style=`, raw ms in transitions outside tokens |
| `raven/no-layout-animation-in-canvas` | bans `motion` imports under `apps/web/src/canvas/**`                                             |
| `raven/require-zod-at-boundary`       | every tRPC procedure and REST handler declares an input schema                                   |
| `raven/no-unbounded-query`            | every Prisma `findMany` in `packages/db` has `take`                                              |
| `raven/ssrf-guarded-fetch`            | outbound `fetch` in `apps/worker` must go through `platform/ssrf.safeFetch`                      |

---

## 4. Client data flow

### 4.1 Read path: Y.Doc → selectors → scene → renderer

```text
Y.Doc (authoritative document)
  │  observeDeep(events)  ── batched into a microtask, coalesced per animation frame
  ▼
DocSnapshot (structurally shared, immutable view produced by packages/domain)
  │  domain selectors: selectNodes(filter), selectEdges, selectGroups, selectProvenance
  ▼
GraphView  (plain objects, no Yjs types cross this line — hard boundary)
  │  buildScene(view, camera, flags)  → LOD, paint hints, z-order, visibility
  ▼
ScenePatch { added[], updated[], removed[], cameraDirty }
  │  engine.setScene(patch)
  ▼
Canvas Engine: spatial index update → cull → paint (Canvas2D) + overlay diff (DOM nodes)
  │
  ▼
React overlay renders only ids in engine.overlay.visibleNodeIds()  (typically 40–150 nodes)
```

Rules:

1. **No Yjs type escapes L4/L3.** `GraphView` contains plain frozen objects. This makes
   `buildScene` benchmarkable and keeps React out of CRDT observation.
2. **One rAF, one scene update.** Doc events are queued into a dirty-set (`Set<nodeId>`); the rAF
   tick converts the dirty set into a `ScenePatch`. Never one React render per Yjs event.
3. **Selectors are memoized by Y.Map clock**, not by deep-equality; `packages/domain/src/select`
   keeps a `WeakMap<Y.AbstractType, {clock, value}>`.
4. **Overlay mounting is throttled**: at most 32 mount/unmount operations per frame, remainder
   deferred to the next frame, so a fast fling never blocks a frame past the 16.6 ms budget (`N1`).

### 4.2 Write path: intent → command → transaction → CRDT → persist → sync → projection

```text
[intent]      user gesture / shortcut / palette action / engine event / proposal accept
   ▼
[command]     packages/domain/src/commands/*.ts   — pure function: (GraphView, args) => Mutation[]
   ▼          validated by zod; rejects illegal mutations with a typed DomainError
[transaction] doc.transact(() => applyMutations(m), origin)     origin = { source, actorId, txId }
   ▼          UndoManager tracks only origin.source === 'local-user' | 'local-proposal'
[CRDT]        Y.Doc updated; observers fire → §4.1 read path repaints (already local-committed)
   ▼
[local]       y-indexeddb writes the update; status 'saving' → 'saved(local)' ≤ 100 ms  (N2)
   ▼
[sync]        HocuspocusProvider ships the update; server acks; status 'saved'          (N2 ≤ 2 s)
   ▼
[projection]  apps/sync onStoreDocument → transaction: snapshot binary + upsert nodes/edges rows
   ▼
[fanout]      Redis → other rooms/pods → other clients apply update, awareness unchanged
```

`Origin` shape (used by undo scoping, audit, and projection attribution):

```ts
export interface Origin {
  source: 'local-user' | 'local-proposal' | 'remote' | 'projection-repair' | 'import';
  actorId: string; // user id or 'system:<service>'
  txId: string; // uuid v7, correlates audit + logs + traces
  proposalId?: string; // set when source === 'local-proposal'
  runId?: string; // set when the proposal came from an integration run
}
```

**Undo scoping.** `new Y.UndoManager(roots, { trackedOrigins: new Set(['local-user','local-proposal','import']), captureTimeout: 400 })`.
Remote edits are never undone locally (`00_MASTER.md` §2). A tool import is one undo step because
`applyProposal` wraps the whole proposal in a single `transact` (`N3`).

### 4.3 Optimistic UX and server-authoritative facts

Graph structure is CRDT-owned and therefore always optimistic and always safe. Facts the server
owns (file upload completion, unfurl result, run status, AI output, permissions) are **not**
written into the document optimistically. They appear as node fields in a `pending` state
(`node.data.state = 'pending' | 'ready' | 'failed'`), and the authoritative value is written by the
client that owns the request when the server responds, or by a `projection-repair` origin if that
client disappeared (§7.5).

---

## 5. Sequence diagrams

Notation: `→` request, `⇢` async/event, `‖` parallel.

### 5.1 App boot and board open (cold, then warm)

```text
Browser            apps/api           apps/sync         IndexedDB/OPFS      Postgres
  │ GET / (CDN)                                             │                 │
  │◄─ index.html + hashed bundles (preload: engine chunk)    │                 │
  │ trpc.auth.session ─────►│                                                  │
  │                         │ verify cookie ────────────────────────────────►  │
  │◄──── {user, orgs, flags, serverTime} ◄──────────────────────────────────── │
  │ route /b/:boardId                                        │                 │
  │ openBoard(boardId) ──────────────────────────────────────►│ read persisted │
  │◄──── Y.Doc hydrated from IndexedDB (t ≈ 40–120 ms)  ◄─────│  updates       │
  │ first paint of canvas from local doc  (interactive, offline-capable)       │
  │ ‖ connect WSS /b/:boardId ────────────────►│                                │
  │                                            │ onAuthenticate(token, boardId) │
  │                                            │  → api.internal.authorizeBoard │
  │                                            │◄─ {allow, role, orgId}         │
  │                                            │ load doc: cache → snapshot ───►│
  │◄────── sync step1/step2 (state vector diff) ◄──────────────────────────────│
  │ apply remote delta → scene patch → repaint                                 │
  │ awareness: publish {cursor:null, viewport, user}                           │
  │ status: 'saved'                                                            │
```

Cold start budget (`N1`: first interactive ≤ 2.5 s): HTML+JS ≤ 900 ms on a 10 Mbps link (bundle
≤ 380 KB gzip for the shell + engine chunk), auth round trip ≤ 150 ms, IndexedDB hydrate ≤ 120 ms,
first canvas frame ≤ 80 ms. WebSocket connect is **not** on the interactive path.

If `boardId` is unknown locally and the network is offline: show the offline board-unavailable
empty state (`03_UX.md` §12), do **not** create an empty doc under that id (it would later merge as
a phantom board).

### 5.2 Paste a URL (`Ctrl+V`)

```text
User        UI(L1)        Domain(L3)      Data(L4)       api            worker        S3
 │ Ctrl+V     │              │              │             │               │            │
 │──────────► │ read clipboard items (text/uri-list, text/plain, files, image)         │
 │            │ classify ──► │ classifyPaste(payload) → {kind:'url', url, normalized}  │
 │            │              │ command: createNodeFromUrl → Mutation[]                  │
 │            │              │ transact(origin local-user) ──►│ Y.Doc + IndexedDB       │
 │            │◄─ node appears at drop point, state='pending', title = hostname         │
 │            │                             │ trpc.unfurl.request({url,nodeId,boardId}) │
 │            │                             │────────────────►│ ssrfGuard(url)          │
 │            │                             │                 │ cache lookup (redis)    │
 │            │                             │                 │  hit → return inline    │
 │            │                             │                 │  miss → enqueue unfurl  │
 │            │                             │◄─ {status:'queued', jobId}                │
 │            │                             │                 │        ⇢ job ─────────► │
 │            │                             │                 │      fetch + parse OG   │
 │            │                             │                 │      screenshot (pool)  │
 │            │                             │                 │      upload derivatives │─►│
 │            │                             │◄── WS/SSE unfurl:done {nodeId, meta}      │
 │            │              │ applyUnfurl(nodeId, meta) → transact(origin local-user)  │
 │            │◄─ node fills: title, description, favicon, screenshot, state='ready'    │
```

Failure paths: SSRF-denied → node stays `ready` with `data.unfurl.error='blocked_private_range'`
and the card shows the URL only (no retry button, since retry cannot succeed);
timeout/5xx → `state='failed'` with a **Retry** action; robots-disallowed screenshot → metadata
kept, screenshot omitted with an explanatory tooltip. See `09_BACKEND.md` §6.

### 5.3 Move 50 nodes (drag)

```text
pointerdown on a selected node
  engine FSM: idle → dragPending (threshold 3 px / 120 ms)
  → drag: engine takes the 50 selected nodes into a "drag layer"
     · their DOM overlays get transform: translate3d(dx,dy,0) only (no layout, no React re-render)
     · far/offscreen members are drawn on canvas as ghosts
     · NO Yjs writes during the drag  ← critical: 50 nodes × 60 fps = 3000 writes/s otherwise
  pointermove (coalesced via getCoalescedEvents, applied once per rAF)
     · snapping computed in the engine (grid 8 px, alignment guides at ≤ 6 px)
  pointerup
  → engine emits node:dragEnd { moves: [{id, x, y}, …] }  (50 entries)
  → domain command moveNodes(moves)
  → ONE doc.transact(origin local-user) writing 50 positions   → ONE undo step (N3)
  → y-indexeddb single update, one WS message (≈ 50 × 28 B payload)
  → projection updates 50 rows in one statement (§7.3)
```

Budget: drag frame p95 ≤ 8 ms for 50 nodes; the transaction at drop ≤ 4 ms;
see `16_PERFORMANCE.md` §4 for the measurement harness.

### 5.4 Run an integration end-to-end

```text
UI            api           Postgres       BullMQ/worker      runner        container      S3
 │ runs.start({integrationId, input, boardId})
 │────────────►│ authz(project:run) ; validate input vs manifest.inputSchema (zod)
 │             │ INSERT runs(status='queued', idempotency_key) ──►│
 │             │ enqueue integration:run {runId} ────────────────────►│
 │◄─ {runId}   │                                                     │
 │ subscribe runs.watch(runId)  (WS channel)                         │
 │                                                    resolve manifest + image digest
 │                                                    POST /exec (mTLS) ──────►│
 │                                                                    spawn container:
 │                                                                    --user 10001:10001
 │                                                                    --read-only, tmpfs /work
 │                                                                    --cap-drop ALL
 │                                                                    --security-opt no-new-privileges
 │                                                                    --pids-limit 256
 │                                                                    --memory 1g --cpus 1.0
 │                                                                    --network none + proxy sidecar
 │                                                                    runtimeClass gVisor (prod)
 │◄─ run:progress (stderr lines, %)  ⇠ ⇠ ⇠ ⇠ ⇠ ⇠ ⇠ ⇠ ⇠ ⇠ ⇠ ⇠ ⇠ ⇠ ⇠ ⇠ ⇠│ stdout/stderr stream
 │                                                     artifacts uploaded ───────────────►│
 │                                     ◄── {exitCode, artifactKeys, durationMs}
 │                       worker: parser(packages/integrations) → entities → node/edge mapping
 │                       → Proposal (never a direct write, N4) → INSERT proposals ──►│
 │◄─ run:done {runId, proposalId, counts}
 │ user reviews diff → accept → §5.6
```

Timeouts: manifest `timeoutMs` (default 120 000, hard cap 900 000); the runner kills the container
with SIGKILL after `timeoutMs + 5 000` and records `status='timeout'` with partial artifacts.

### 5.5 Offline edit then reconnect

```text
t0  online, status 'saved'
t1  network drops → provider 'disconnected' → status 'offline' (visible, N2)
t2  user creates 12 nodes, moves 30, deletes 4
      · every transaction still hits IndexedDB ≤ 100 ms
      · outgoing updates buffer in the provider queue (bounded: 25 MB, see below)
      · server-owned operations (unfurl, run start, upload) are queued as *pending intents*
        in a local Y.Map 'pendingIntents' with a client-generated idempotency key
t3  reconnect → provider syncs: step1 state vector exchange, step2 both directions
      · CRDT merge is automatic; no conflict dialog for structure
      · concurrent delete vs edit resolves to "deleted wins" for the node map entry, and the
        edit survives in history; UI shows a one-time toast "3 items you edited were removed by
        another user — Restore?" (restore = re-apply from history, one undo step)
t4  pendingIntents drained in order; each API call carries its idempotency key so a duplicate
      submission after a partial send is a no-op (09_BACKEND.md §8.4)
t5  status 'saved'
```

Bounded queue policy: if buffered offline updates exceed 25 MB or 30 days, the client compacts by
writing a fresh snapshot into IndexedDB and dropping the update log (Yjs semantics preserve state);
if the doc itself exceeds 60 MB the user is warned to export and split the board.

### 5.6 AI proposal accept

```text
UI                    api              worker/AI            Postgres         Y.Doc
 │ ai.suggestLinks({boardId, scope}) ─►│ budget check (org monthly credits)
 │                                      │ enqueue ai:suggest ─────►│
 │                                      │           build context: graph view slice, capped at
 │                                      │           12 000 tokens; PII/secret redaction pass
 │                                      │           AIProvider.complete(...) → structured JSON
 │                                      │           validate with zod ProposalSchema; drop invalid
 │◄─ ai:done {proposalId}               │           INSERT proposals(status='pending') ──►│
 │ open Proposal Review panel: per-item diff (add edge A→B 'references', confidence 0.72, why…)
 │ user toggles items; Accept selected
 │ proposals.accept({proposalId, itemIds}) ─►│ authz ; mark accepted ──────────────────►│
 │◄─ {proposal with resolved payload}
 │ domain.applyProposal(doc, proposal, {source:'local-proposal', proposalId, actorId})
 │   · one transact → one undo step (N3)
 │   · every created node/edge stamped: source, tool:'ai', model, run_id, observed_at, confidence
 │ status 'saving' → 'saved'; toast "Added 9 links — Undo"
```

Rejected items are recorded (`proposal_items.status='rejected'`) and feed the "don't suggest again"
suppression list keyed by `(boardId, itemFingerprint)`.

### 5.7 Export report

```text
UI            api             worker                 Postgres        S3
 │ exports.create({boardId, format:'pdf', options}) ─►│
 │             │ authz(project:export) ; snapshot the CURRENT projection at doc_version V
 │             │ INSERT exports(status='queued', doc_version=V) ─►│
 │             │ enqueue export:build ───────────────►│
 │◄─ {exportId}│                                       read nodes/edges @V + provenance
 │             │                                       render board image tiles (headless)
 │             │                                       compose document (React-PDF/HTML→PDF)
 │             │                                       include: cover, graph map, per-entity
 │             │                                       provenance table, run log, appendix
 │             │                                       upload → S3 key exports/{org}/{id}.pdf ─►│
 │◄─ export:done {exportId, size, pages}
 │ download via presigned GET (TTL 900 s)
```

`JSON v1` export (`N9`) is produced synchronously in the client from the doc for boards
< 20 000 elements, and server-side (same serializer, run in worker) above that. The serializer
lives once in `packages/domain/src/io/exportV1.ts` and is shared by both.

---

## 6. Error and retry taxonomy

### 6.1 Error classes

```ts
export type ErrorClass =
  | 'validation' // client sent something invalid — never retry
  | 'auth' // unauthenticated / expired session — re-auth then retry once
  | 'permission' // authenticated but not allowed — never retry
  | 'not_found' // gone or never existed — never retry
  | 'conflict' // idempotency or version conflict — resolve then retry
  | 'rate_limited' // retry after server-provided delay
  | 'upstream' // third-party failed — retry with backoff, bounded
  | 'timeout' // deadline exceeded — retry with backoff, bounded
  | 'blocked' // policy denied (SSRF, robots, acceptable use) — never retry
  | 'capacity' // queue/pool exhausted — retry with backoff
  | 'internal'; // our bug — retry once, then surface

export interface RavenError {
  class: ErrorClass;
  code: string; // stable machine code e.g. 'UNFURL_PRIVATE_RANGE'
  message: string; // developer-facing
  userMessage: string; // what happened / why / what to do (00_MASTER §10.5)
  retryable: boolean;
  retryAfterMs?: number;
  details?: unknown;
  txId: string;
  cause?: string;
}
```

### 6.2 Retry policy per surface

| Surface                 | Policy                                                                     | Max attempts | Ceiling |
| ----------------------- | -------------------------------------------------------------------------- | ------------ | ------- |
| tRPC query (idempotent) | exponential 250 ms × 2^n ± 20% jitter                                      | 3            | 4 s     |
| tRPC mutation           | no automatic retry unless `idempotencyKey` present; then 2                 | 2            | 2 s     |
| WS sync reconnect       | 1 s, 2 s, 4 s, 8 s, 15 s, then every 15 s ± jitter                         | ∞            | 15 s    |
| Unfurl fetch            | 1 s, 4 s, 15 s                                                             | 3            | 15 s    |
| Screenshot              | 2 s, 10 s                                                                  | 2            | 10 s    |
| Integration run         | **no automatic retry** (side-effectful, costs quota); explicit "Run again" | 0            | —       |
| AI call                 | 1 s, 5 s (only on `upstream`/`timeout`/`rate_limited`)                     | 3            | 20 s    |
| Export                  | 5 s, 30 s                                                                  | 2            | 30 s    |
| Projection write        | 100 ms, 500 ms, 2 s, then DLQ + repair job                                 | 4            | 2 s     |
| Blob upload             | 1 s, 3 s, 9 s (per part)                                                   | 3            | 9 s     |

Circuit breaker on every outbound third-party host: 10 failures within 60 s opens the breaker for
120 s; while open, jobs fail fast with `class:'upstream', code:'BREAKER_OPEN'` and the UI shows
"GitHub is not responding — we'll keep the run queued for 10 minutes."

### 6.3 Degradation ladder

1. Sync down → full local editing, "Offline" chip, no presence.
2. API down → board editing continues; unfurl/upload/run/search disabled with explanatory states.
3. Worker down → jobs queue; UI shows "queued" with position, no failure until TTL (30 min).
4. Runner down → runs rejected at start with `capacity` and an ETA, never silently queued forever.
5. AI provider down → AI entry points disabled with a reason tooltip; deterministic features
   (dedupe by exact match, layout) remain available.

---

## 7. Projection: Yjs binary → Postgres rows

### 7.1 Purpose and guarantees

The Y.Doc is authoritative; `nodes` and `edges` tables are a **derived, idempotent, rebuildable
projection** used for search, exports, integrations, permissions-scoped queries and analytics.
Guarantees:

- **G1 Idempotent** — projecting the same doc version twice yields identical rows.
- **G2 Monotonic** — a row is never written from a doc version older than the row's `doc_version`.
- **G3 Rebuildable** — dropping all projection rows for a board and replaying from the latest
  binary snapshot reproduces them exactly; therefore projection failure is never data loss.
- **G4 Bounded lag** — p95 projection lag ≤ 2 s after the debounce window; alert at 30 s.

### 7.2 Trigger points

`apps/sync` uses the Hocuspocus `Database` extension:

```ts
new Database({
  fetch: async ({ documentName }) => loadLatestSnapshot(documentName),
  store: async ({ documentName, state, document }) => {
    await withTx(async (tx) => {
      const version = nextDocVersion(documentName); // monotonic bigint per board
      await storeSnapshot(tx, documentName, state, version); // binary, compressed
      await projectBoard(tx, documentName, document, version);
    });
  },
});
```

`store` is debounced by Hocuspocus (`debounce: 2000 ms`, `maxDebounce: 10000 ms`). Snapshot binary
is written every store; a **checkpoint snapshot** (full, retained) is written every 200 stores or
15 minutes, whichever comes first (`09_BACKEND.md` §13.1).

### 7.3 Algorithm

```text
projectBoard(tx, boardId, ydoc, version):
  1. read the projection cursor:  SELECT projected_version, projected_hash FROM boards WHERE id=$1 FOR UPDATE
  2. if projected_version >= version: return           # G2
  3. nodesMap = ydoc.getMap('nodes'); edgesMap = ydoc.getMap('edges')
  4. build desired = { nodes: Map<id, Row>, edges: Map<id, Row> } via packages/domain
       Row.content_hash = sha256(canonicalJson(entityWithoutVolatileFields))
  5. load current = SELECT id, content_hash FROM nodes WHERE board_id=$1   (same for edges)
  6. diff:
       toInsert = desired \ current
       toUpdate = { id in both, content_hash differs }
       toDelete = current \ desired
  7. apply, edges before nodes on delete, nodes before edges on insert (FK order):
       DELETE FROM edges WHERE board_id=$1 AND id = ANY($2)
       INSERT INTO nodes (...) SELECT * FROM UNNEST(...) ON CONFLICT (id) DO UPDATE
         SET ... WHERE nodes.doc_version < EXCLUDED.doc_version      # G2 at row level
       INSERT INTO edges (...) ... ON CONFLICT DO UPDATE ...
       DELETE FROM nodes WHERE board_id=$1 AND id = ANY($2)
  8. refresh derived: tsvector columns are generated columns (no extra step);
       embeddings enqueued only for nodes whose text_hash changed (queue: ai:embed)
  9. UPDATE boards SET projected_version=$version, projected_at=now(), projected_hash=$h
 10. emit metric raven_projection_rows{op} and raven_projection_lag_seconds
```

Complexity: O(changed) writes, O(board size) reads of `(id, content_hash)` — for a 5 000-node board
that read is ≈ 5 000 × 40 B = 200 KB, acceptable at a 2 s debounce. Above 20 000 elements the
projector switches to **delta mode**: it consumes the Yjs update's changed-key set (captured in an
`observeDeep` on the server-side doc) and only diffs those ids, falling back to full mode whenever
the changed-key set is unavailable (e.g. after a cold room load).

### 7.4 Replay and backfill

- `pnpm raven projection:replay --board <id> [--from-snapshot <version>]` — loads the snapshot,
  reconstructs the doc in a headless Yjs instance, runs `projectBoard` with `force=true`
  (bypasses G2 by taking the snapshot's version), and reports a row-level diff before applying
  when `--dry-run`.
- `projection:backfill --org <id> --concurrency 4` — iterates boards where
  `projected_version < doc_version` or `projected_at < now() - interval '1 day'`.
- A nightly maintenance job (`maintenance:projection-audit`) samples 2% of boards, recomputes the
  projection hash in memory and compares; mismatch raises `raven_projection_mismatch_total` and
  auto-enqueues a replay for that board.
- Projection code version is stamped in `boards.projector_version`; bumping it (schema change in
  the derived rows) triggers a rolling backfill instead of a big-bang migration.

### 7.5 Server-authored writes back into the doc

Some flows must write into the Y.Doc from the server (unfurl completion when the originating client
is gone, run proposal auto-accept is _not_ permitted — N4). This is done by `apps/sync` opening the
room server-side and applying a transaction with `origin.source='projection-repair'` and
`actorId='system:sync'`. Rules: (a) only fields under `node.data.serverManaged.*` may be written
this way; (b) such writes are excluded from client undo; (c) every such write appends an audit row.

---

## 8. Multi-tenant isolation

### 8.1 Model

```text
Organization (tenant)
 └─ Project        (ACL boundary; roles: owner, admin, editor, viewer)
     └─ Board      (Y.Doc room; inherits project ACL, may be further restricted to 'private')
         └─ Nodes / Edges / Groups
Also org-scoped: files, runs, integrations credentials, exports, audit, AI budget.
```

### 8.2 Enforcement points (defense in depth)

1. **Session** — Better-Auth session → `{userId, orgIds[]}`; every request resolves an
   `AuthContext` in Fastify `preHandler`.
2. **Procedure** — tRPC middleware `requireProject(role)` / `requireBoard(role)`; no procedure may
   accept an org id from the client without membership check (lint: every `*.input(z.object({orgId`
   must be paired with `requireOrg`).
3. **Repository** — every repository function takes `scope: {orgId, projectId?}` as its first
   argument, and every query includes the scope column. `packages/db` exposes no raw `prisma`
   outside `packages/db/src/**`.
4. **Database** — Postgres RLS enabled on `nodes`, `edges`, `files`, `runs`, `exports`, `audit`
   with policy `org_id = current_setting('raven.org_id')::uuid`; the connection sets
   `raven.org_id` per transaction. RLS is a backstop, not the primary control.
5. **Room** — Hocuspocus `onAuthenticate` maps `documentName` (`board:<uuid>`) to the board, checks
   membership, and attaches `context.role`; `onBeforeHandleMessage` rejects writes for `viewer`.
6. **Object storage** — keys are prefixed `org/{orgId}/…`; presigned URLs are issued only after the
   scope check and are scoped to the exact key, method and ≤ 900 s TTL.
7. **Jobs** — every job payload carries `orgId`; the worker sets the RLS setting from the payload
   and refuses jobs whose `orgId` does not match the referenced entity.
8. **Runner** — one container per run, no shared writable volume, network egress allowlist derived
   from the manifest, credentials injected as env from the org's secret, never logged.

### 8.3 Noisy-neighbour controls

| Resource                    | Per-org limit (default plan)            | Enforcement                                  |
| --------------------------- | --------------------------------------- | -------------------------------------------- |
| Concurrent integration runs | 3                                       | Redis semaphore `run:sem:{orgId}`            |
| Queued jobs                 | 500                                     | enqueue-time check → `capacity` error        |
| Unfurl req/min              | 120                                     | token bucket in Redis                        |
| AI tokens/month             | plan-defined                            | pre-flight budget check + hard stop          |
| Board size                  | 50 000 elements soft warn, 100 000 hard | client warn + server reject on import        |
| Storage                     | plan-defined                            | quota table, checked at presign              |
| WS messages/s per socket    | 200                                     | Hocuspocus custom guard, disconnect on abuse |

---

## 9. Feature flags

### 9.1 Mechanism

Flags are evaluated server-side and delivered in the session payload; the client reads them from a
frozen `flags` object. No flag is read from `localStorage` in production except developer overrides
gated by `import.meta.env.DEV`.

```ts
export const FlagSchema = z.object({
  key: z.string().regex(/^[a-z0-9.\-]+$/),
  scope: z.enum(['global', 'org', 'project', 'user']),
  value: z.union([z.boolean(), z.number(), z.string()]),
  rollout: z.object({ percent: z.number().min(0).max(100), salt: z.string() }).optional(),
});
export type Flags = Readonly<Record<FlagKey, boolean | number | string>>;
```

Percentage rollout is deterministic: `hash(salt + ':' + orgId) % 100 < percent` — stable per org, so
a board never flickers between two canvas code paths mid-session.

### 9.2 Registered flags

| Key                                            | Type   | Default             | Owner | Removal condition                                               |
| ---------------------------------------------- | ------ | ------------------- | ----- | --------------------------------------------------------------- |
| `canvas.hybridOverlay`                         | bool   | true                | L2    | permanent kill-switch (falls back to full-canvas LOD rendering) |
| `canvas.lodThreshold`                          | number | 0.55                | L2    | permanent tuning knob                                           |
| `canvas.edgeRouterWorker`                      | bool   | true                | L2    | remove after P16 if stable 2 releases                           |
| `sync.enabled`                                 | bool   | true                | L4    | permanent kill-switch (local-only mode)                         |
| `sync.presence`                                | bool   | true                | L4    | permanent                                                       |
| `capture.screenshots`                          | bool   | true                | L7    | permanent (browser pool cost control)                           |
| `integrations.sherlock`                        | bool   | false               | L7    | on at P11 GA                                                    |
| `integrations.spiderfoot`                      | bool   | false               | L7    | on at P12 GA; **stays a kill-switch** (§10 ADR-011)             |
| `integrations.github`                          | bool   | false               | L7    | on at P10 GA                                                    |
| `ai.enabled`                                   | bool   | false               | L8    | permanently off — AI layer cancelled 2026-08-22                 |
| `ai.provider`                                  | string | `openai-compatible` | L8    | permanent                                                       |
| `views.timeline` / `views.map` / `views.table` | bool   | false               | L1    | on at P14 GA                                                    |
| `export.pdf`                                   | bool   | false               | L1    | on at P15 GA                                                    |
| `plugins.enabled`                              | bool   | false               | L9    | on after plugin sandbox audit                                   |
| `search.semantic`                              | bool   | false               | L6    | on at P11                                                       |

Every flag must have an owner layer and a removal condition; a flag older than two releases past
its removal condition fails the architecture gate.

---

## 10. Configuration and environment matrix

### 10.1 Environment variable contract

Validated at process start with zod in `packages/platform/src/env.ts`; a missing or invalid var is a
**fatal startup error**, never a silent default (except where a default is listed).

| Variable                                                              | Services                  | Type                            | Default                      | Notes                                              |
| --------------------------------------------------------------------- | ------------------------- | ------------------------------- | ---------------------------- | -------------------------------------------------- |
| `NODE_ENV`                                                            | all                       | `development\|test\|production` | —                            |                                                    |
| `NEXUS_ENV`                                                           | all                       | `local\|ci\|staging\|prod`      | —                            | drives flag defaults and log format                |
| `DATABASE_URL`                                                        | api, sync, worker         | url                             | —                            | Prisma; pool size below                            |
| `DATABASE_POOL_MAX`                                                   | api, sync, worker         | int                             | api 20 / sync 10 / worker 10 |                                                    |
| `REDIS_URL`                                                           | api, sync, worker, runner | url                             | —                            |                                                    |
| `S3_ENDPOINT`,`S3_BUCKET`,`S3_REGION`,`S3_ACCESS_KEY`,`S3_SECRET_KEY` | api, worker               | —                               | —                            | MinIO in dev                                       |
| `AUTH_SECRET`                                                         | api, sync                 | secret ≥ 32 B                   | —                            | Better-Auth                                        |
| `AUTH_URL`                                                            | api                       | url                             | —                            | public origin                                      |
| `PUBLIC_WEB_ORIGIN`                                                   | api, sync                 | url                             | —                            | CORS + WS origin allowlist                         |
| `SYNC_PORT` / `API_PORT`                                              | sync / api                | int                             | 1234 / 3000                  |                                                    |
| `SYNC_INTERNAL_TOKEN`                                                 | api, sync                 | secret                          | —                            | sync→api authorizeBoard call                       |
| `RUNNER_URL`, `RUNNER_MTLS_CERT/KEY/CA`                               | worker, runner            | —                               | —                            | internal only                                      |
| `RUNNER_RUNTIME_CLASS`                                                | runner                    | string                          | `runc` local / `gvisor` prod |                                                    |
| `EGRESS_PROXY_URL`                                                    | worker, runner            | url                             | —                            | allowlisting proxy                                 |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`                               | worker                    | —                               | —                            | OpenAI-compatible                                  |
| `BROWSER_POOL_SIZE`                                                   | worker                    | int                             | 2 (dev) / 6 (prod)           | headless screenshots                               |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                         | all                       | url                             | —                            | optional in local                                  |
| `LOG_LEVEL`                                                           | all                       | pino level                      | `info`                       |                                                    |
| `RATE_LIMIT_DISABLED`                                                 | api                       | bool                            | false                        | only allowed when `NEXUS_ENV=local` (hard-checked) |

### 10.2 Environment matrix

| Aspect         | local                 | ci                            | staging            | prod                 |
| -------------- | --------------------- | ----------------------------- | ------------------ | -------------------- |
| Compose/K8s    | docker-compose        | compose (ephemeral)           | k8s                | k8s                  |
| Postgres       | container, no replica | container, tmpfs              | managed, 1 replica | managed, HA + PITR   |
| Redis          | container             | container                     | managed            | managed, sentinel    |
| Object store   | MinIO                 | MinIO                         | S3                 | S3 + lifecycle rules |
| Runner runtime | `runc` + full flags   | runner disabled (mocked)      | gVisor             | gVisor               |
| Egress proxy   | permissive log-only   | blocked (no network in tests) | allowlist          | allowlist + audit    |
| Sync replicas  | 1                     | 1                             | 2                  | ≥ 3                  |
| Flags          | all on                | deterministic fixture set     | staged rollout     | staged rollout       |
| Telemetry      | console               | none                          | OTLP               | OTLP + alerting      |
| Seed data      | demo board            | fixtures                      | anonymized         | none                 |

Config precedence: process env → `.env.<NEXUS_ENV>` → `.env` → schema default. Secrets never come
from files in prod (k8s Secret → env). See `19_DEPLOYMENT.md` §3.

---

## 11. Observability signals per layer

Conventions: metrics are Prometheus-style `raven_<area>_<name>_<unit>`; traces are OpenTelemetry
with `txId` propagated from the client as `traceparent`; logs are pino JSON with a mandatory
`{txId, orgId, userId?, boardId?, service}` base.

| Layer       | Key metrics                                                                                                                                                                   | Key spans                                    | Key log events                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| L1 UI       | `raven_ui_route_render_ms`, `raven_ui_interaction_latency_ms{action}`, `raven_ui_error_boundary_total`                                                                        | `ui.boardOpen`, `ui.commandPalette`          | unhandled rejection, error boundary trip        |
| L2 Canvas   | `raven_canvas_frame_ms{p50,p95}`, `raven_canvas_nodes_drawn`, `raven_canvas_overlay_mounts_total`, `raven_canvas_index_query_ms`                                              | `canvas.frame` (sampled 1%), `canvas.layout` | dropped-frame burst (> 5 frames > 33 ms)        |
| L3 Domain   | `raven_domain_scene_build_ms`, `raven_domain_proposal_apply_ms`, `raven_domain_validation_fail_total{schema}`                                                                 | `domain.applyProposal`                       | proposal rejected with reason                   |
| L4 Data     | `raven_sync_status_seconds{status}`, `raven_doc_update_bytes`, `raven_idb_write_ms`, `raven_ws_reconnects_total`                                                              | `data.openBoard`, `data.transact`            | offline enter/exit, queue high-water            |
| L5 API      | `raven_http_request_ms{route,code}`, `raven_trpc_call_ms{procedure}`, `raven_ratelimit_block_total{rule}`                                                                     | one span per request                         | 4xx with `class`, all 5xx                       |
| L6 Persist  | `raven_db_query_ms{repo}`, `raven_projection_lag_seconds`, `raven_projection_rows_total{op}`, `raven_projection_mismatch_total`, `raven_snapshot_bytes`                       | `db.tx`, `projection.board`                  | projection retry, DLQ entry                     |
| L7 Exec     | `raven_job_wait_ms{queue}`, `raven_job_run_ms{queue}`, `raven_job_fail_total{queue,code}`, `raven_run_duration_ms{integration}`, `raven_runner_container_kills_total{reason}` | `job.<name>`, `runner.exec`                  | run start/end with exit code, sandbox violation |
| L8 AI       | `raven_ai_tokens_total{dir,model}`, `raven_ai_cost_usd_total{org}`, `raven_ai_latency_ms`, `raven_ai_proposal_accept_ratio`                                                   | `ai.complete`                                | budget exhausted, schema-invalid completion     |
| L9 Platform | `raven_auth_failures_total{reason}`, `raven_ssrf_block_total{reason}`, `raven_flag_eval_total{key}`, `raven_build_info`                                                       | —                                            | authz denial, config load                       |

Four SLOs are alerted on: board open p95 < 2.5 s; sync ack p95 < 2 s; projection lag p95 < 2 s;
API 5xx rate < 0.5% over 15 min. RED dashboards per service, USE dashboards for Postgres/Redis.
Frontend metrics are sampled (10% of sessions, 1% of frames) and shipped in batches of ≤ 50 every
15 s to `POST /api/v1/telemetry`, dropped entirely when the user opts out.

---

## 12. Architecture Decision Records

Format: **Context → Decision → Consequences → Rejected alternatives.** These ADRs restate and
justify the frozen decisions of `00_MASTER.md` §2; they cannot be reopened without a master edit.

### ADR-001 — Custom hybrid canvas engine

**Context.** Requirement N1 (5 000 nodes at 60 fps) with rich HTML cards (favicons, rich text,
previews). React Flow renders every node as React DOM plus SVG edges and degrades around several
hundred rich DOM nodes. tldraw sustains large scenes with a spatial index, viewport culling
(`display:none` for offscreen shapes) and a stable "efficient zoom level" during camera movement,
but owns its own document and shape model.
**Decision.** Build `packages/canvas-engine`: Canvas2D for edges/grid/marquee/far-LOD nodes, a DOM
overlay only for visible near-zoom nodes, an R-tree-style spatial index, LOD switch at zoom 0.55,
and quantized zoom during camera movement — applying tldraw's _techniques_ to our own data model.
**Consequences.** We own hit testing, text rendering fidelity at far LOD, and accessibility of
canvas-drawn content (mitigated: DOM overlay carries the accessible tree for visible nodes).
Highest-risk subsystem; it is built first (P2) and guarded by a CI benchmark.
**Rejected.** React Flow (perf ceiling), tldraw (document model conflict with Yjs entity graph),
pure WebGL/PixiJS (loses HTML/rich-text fidelity and a11y), plain SVG (worst of both).

### ADR-002 — Yjs as the document, Zustand for ephemeral UI state

**Context.** Offline-first (req. 22), persistence (req. 21), realtime collaboration and undo/redo
under concurrency are one problem.
**Decision.** One `Y.Doc` per board is the document; Zustand holds only ephemeral UI state (panel
open, hover, tool mode) and is never persisted to the doc.
**Consequences.** Conflict-free merge for free; binary is not queryable → projection (ADR-004);
developers must respect the "no Yjs types past the domain boundary" rule.
**Rejected.** Automerge (larger payloads, smaller ecosystem for a WS server + IndexedDB provider),
custom OT (years of work), server-authoritative REST with polling (breaks offline and realtime),
Zustand-as-document with manual persistence (no concurrency story).

### ADR-003 — `Y.UndoManager` scoped by origin

**Context.** N3 requires undo for every mutation including imports and AI, while remote edits must
never be undone locally.
**Decision.** One `Y.UndoManager` per board over the graph roots, `trackedOrigins =
{local-user, local-proposal, import}`, `captureTimeout = 400 ms`; proposals and drags apply as a
single transaction so they are a single undo step.
**Consequences.** Every writer must pass a correct `Origin`; a missing origin is a lint error.
Server-authored `projection-repair` writes are deliberately not undoable.
**Rejected.** Hand-rolled command stack (breaks under concurrent remote edits), per-mutation undo
records in Postgres (latency, and cannot express CRDT merges).

### ADR-004 — Postgres projection of the CRDT

**Context.** Search, exports, integrations, admin and analytics need queryable graph data; the CRDT
binary is opaque.
**Decision.** `apps/sync` projects each stored doc version into `nodes`/`edges` rows in the same
transaction as the binary snapshot; the projection is idempotent, monotonic and replayable (§7).
**Consequences.** Eventual consistency of up to ~2 s between doc and queries — acceptable because
the client always reads the doc for rendering; a second code path (the projector) must stay in sync
with the doc schema, enforced by shared serializers in `packages/domain`.
**Rejected.** Query the CRDT server-side per request (no indexes, O(doc)), a graph database
(second stateful system to operate for queries recursive CTEs already answer), event-sourcing the
graph separately (duplicate truth).

### ADR-005 — Separate `sync` service from `api`

**Context.** Long-lived stateful rooms vs stateless request handling; N5 also demands the API
process be free of execution capability.
**Decision.** `apps/sync` (Hocuspocus 4 with Redis fanout) and `apps/api` (Fastify 5 + tRPC v11)
are separate deployables; sync calls api's internal `authorizeBoard` endpoint for ACL decisions.
**Consequences.** One more service and an internal auth token/mTLS hop; deploys of API do not drop
board sessions; independent scaling.
**Rejected.** Single process (deploy churn kills sessions; coupled scaling), sync inside a
serverless runtime (WebSocket lifetime and memory model do not fit).

### ADR-006 — tRPC for the app, REST/OpenAPI for third parties

**Context.** One first-party client that benefits from end-to-end types; plugins and webhooks need
a stable, language-neutral contract.
**Decision.** tRPC v11 at `/trpc` for `apps/web`; a versioned REST surface at `/api/v1` with a
generated OpenAPI document for plugins, webhooks and automation.
**Consequences.** Two surfaces to maintain; mitigated by implementing REST as thin controllers over
the same service layer that tRPC procedures call — business logic exists once.
**Rejected.** REST only (loses type safety and refactor velocity), GraphQL (schema+resolver
overhead, N+1 risk, no benefit for a single known client), tRPC exposed publicly (unstable
contract, poor non-TS ergonomics).

### ADR-007 — BullMQ + Redis for jobs

**Context.** Unfurl, screenshots, thumbnails, repo analysis, AI, exports and maintenance are
asynchronous and bursty; Redis already exists for sync fanout and rate limits.
**Decision.** BullMQ queues with per-queue concurrency, priorities, exponential backoff,
idempotency keys and dead-letter queues (`09_BACKEND.md` §8).
**Consequences.** Redis becomes a availability-relevant dependency for background work (not for
editing); jobs must be idempotent since at-least-once delivery is possible.
**Rejected.** pg-boss (fewer features around rate limiting/priorities; adds load to the primary DB),
Kafka (operational weight far beyond need), in-process timers (lost on deploy).

### ADR-008 — Sandboxed runner as a separate service

**Context.** N5: third-party OSINT tools are untrusted code that must never run in the API process.
**Decision.** `apps/runner` executes each run in an ephemeral container with `--user` non-root,
`--read-only` rootfs, tmpfs workdir, `--cap-drop ALL`, `--security-opt no-new-privileges`,
`--pids-limit`, memory/CPU caps, no direct network (egress only through an allowlisting proxy), and
a gVisor runtime class in production. Runner has no database client.
**Consequences.** Extra hop and image management; container-level cold start (~300–800 ms) added to
every run; strong blast-radius containment.
**Rejected.** In-process execution (unacceptable), plain `child_process` on the API host (no
isolation), Firecracker microVMs (stronger but heavier to operate; revisit if gVisor proves
insufficient), running tools client-side (impossible for Python CLIs).

### ADR-009 — Integrations as manifests, not code paths

**Context.** Requirement: add tools without touching the core; a plugin SDK must expose the same
mechanism.
**Decision.** A tool = manifest (image digest, input schema, arg template, timeouts, egress
allowlist, output contract) + a parser module in `packages/integrations`. One generic pipeline
executes all of them; the application core has zero tool-specific branches.
**Consequences.** Core changes required only for genuinely new capability classes; parsers are
individually testable against recorded fixtures; manifest validation becomes a security control.
**Rejected.** Per-tool service code (combinatorial growth, N-way regression risk), shelling out
from the API with ad-hoc parsing (violates N5 and N4).

### ADR-010 — Sherlock adapter design

**Context.** Sherlock (`sherlock-project/sherlock`, MIT, latest release v0.16.0 dated 2025-09-16) is
an actively maintained Python CLI covering ~400+ sites, with flags including `--json FILE`,
`--site`, `--timeout`, `--print-found`, `--nsfw`, `--local`, `--proxy`, and an official
`sherlock/sherlock` Docker image.
**Decision.** Run the official image pinned by digest, always with `--json /work/out.json`, an
explicit `--timeout`, and the proxy flag pointed at our egress proxy; parse the JSON artifact into
`identity`/`account` entities with per-site provenance and confidence.
**Consequences.** Output shape is treated as an **adapter assumption validated at runtime**: the
parser validates against a zod schema and, on mismatch, fails the run with
`code:'ADAPTER_OUTPUT_MISMATCH'`, stores the raw artifact, and offers "import raw result as an
evidence node" instead of guessing. Site coverage varies per release; the manifest records the
digest and version so provenance is reproducible.
**Rejected.** Re-implementing username enumeration ourselves (maintenance burden, worse coverage),
parsing stdout text (unstable), invoking Sherlock as a Python library in-process (violates N5).

### ADR-011 — SpiderFoot adapter with an explicit maintenance risk posture

**Context.** SpiderFoot (`smicallef/spiderfoot`, MIT, stable v4.0) offers a web UI, an HTTP API on
the `sfwebui` server, the `sfcli.py` interactive client and the `sf.py` CLI. deps.dev (June 2026)
reports zero commits and no issue activity in the previous 90 days — **low maintenance activity**.
**Decision.** Integrate SpiderFoot behind the same manifest/adapter boundary as any other tool,
pinned to a specific image digest, driven through `sf.py`/`sfcli.py` in the sandbox with results
read from the produced artifacts; keep `integrations.spiderfoot` as a permanent kill-switch flag;
document a fallback path (disable the integration; the module-level capabilities we depend on most —
DNS, WHOIS, certificate transparency, breach lookups — are listed in `12_SPIDERFOOT.md` §7 as
candidates for first-party adapters if the project becomes unmaintained).
**Consequences.** A stale upstream cannot break the core product: no core code knows about
SpiderFoot; a CVE in the pinned image degrades to switching the flag off. Version drift is detected
by a weekly manifest-health job that compares the pinned digest to the published tag.
**Rejected.** Deep integration through its database or internal modules (couples us to an
unmaintained codebase), running SpiderFoot's web UI as a user-facing surface (auth and network
exposure we do not control), dropping it entirely (its module breadth is a real product value today).

### ADR-012 — Better-Auth with Postgres-backed sessions

**Context.** Self-hosting is a product requirement for OSINT users; no vendor lock-in is acceptable.
**Decision.** Better-Auth with email + OAuth providers, sessions stored in Postgres, org/project
RBAC implemented in our own tables and evaluated in `packages/platform/authz`.
**Consequences.** We own the RBAC policy surface and its tests; session revocation is immediate
because sessions are DB-backed; one extra DB read per request (cached 30 s in Redis, invalidated on
revoke).
**Rejected.** Hosted identity providers (breaks self-hosting), JWT-only stateless sessions
(revocation and org-switch semantics become painful), rolling our own auth (security risk).

### ADR-013 — Design tokens as CSS custom properties with a generated Tailwind v4 preset

**Context.** `00_MASTER.md` §10.6 bans hardcoded design values; a light theme must arrive later
without touching components.
**Decision.** One token source of truth in `packages/ui/tokens/*.json`, compiled into CSS custom
properties and into a Tailwind v4 preset; components consume semantic tokens only.
**Consequences.** Theme switching is a `:root` variable swap; a lint rule blocks raw values; token
renames are a build-time break rather than a runtime surprise.
**Rejected.** CSS-in-JS runtime theming (runtime cost on a canvas-heavy app), Tailwind with
arbitrary values (defeats the token contract), plain CSS modules only (loses utility velocity).

### ADR-014 — Proposal object as the only write path for tools and AI

**Context.** N4 and product principle "nothing silently changes data".
**Decision.** Every non-human-originated mutation is materialized as a `Proposal` (items with a
diff, rationale, confidence and provenance), reviewed in UI, and applied only through
`domain.applyProposal` in a single transaction.
**Consequences.** Uniform review UX for tools and AI; one undoable step per import; a lint rule and
an e2e matrix can prove the invariant; slight friction for users who want auto-import — mitigated by
per-integration "auto-accept high-confidence items" _preferences_ that still create the proposal
record and still produce one undo step and an audit entry.
**Rejected.** Direct writes with an audit trail (unreviewable, unexplainable, hard to undo),
staging boards (extra concept for users), server-side auto-merge (violates N4).

---

## 13. Open risks

| #   | Risk                                                                                                                  | Impact                         | Mitigation / trigger                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | The hybrid canvas fails to hold 60 fps with rich DOM overlays on a 2020-class laptop at high node density in-viewport | N1 misses; product credibility | Benchmark from P2 day one; fallback ladder: reduce overlay budget → raise LOD threshold → canvas-only text rendering behind `canvas.hybridOverlay=false`     |
| R2  | Projection drifts from the doc after a schema change or a partial failure                                             | Wrong search/export results    | G1–G3 guarantees, `projector_version` gating, nightly 2% audit job, one-command replay                                                                       |
| R3  | Yjs doc growth on long-lived boards (thousands of edits) degrades load time                                           | Slow board open                | Checkpoint snapshots, client-side compaction, 50 000-element soft warning, split-board flow in `03_UX.md`                                                    |
| R4  | SpiderFoot becomes unmaintained or ships a CVE                                                                        | Feature loss                   | Digest pinning, kill-switch flag, weekly manifest-health job, first-party adapter candidates listed in `12_SPIDERFOOT.md` §7                                 |
| R5  | Sherlock output schema changes between releases                                                                       | Broken parser                  | zod-validated adapter with `ADAPTER_OUTPUT_MISMATCH` failure and raw-artifact import fallback; digest pinning                                                |
| R6  | gVisor unavailable or performance-prohibitive on the target cluster                                                   | Weaker isolation               | Runtime class is configuration (`RUNNER_RUNTIME_CLASS`); documented minimum posture is the full container flag set; escalation path is Firecracker (ADR-008) |
| R7  | Headless browser pool cost/instability for screenshots                                                                | Unfurl quality drops           | `capture.screenshots` flag, per-org rate limit, metadata-only fallback is a complete experience                                                              |
| R8  | Offline queue growth beyond 25 MB on very long disconnects                                                            | Client memory pressure         | Compaction policy §5.5, explicit user warning, export path                                                                                                   |
| R9  | Two write paths (client doc + server `projection-repair`) create subtle races                                         | Field flapping                 | Server writes restricted to `data.serverManaged.*`, last-writer-wins per field with `observed_at`, audit row for every server write                          |
| R10 | tRPC and REST surfaces diverge in behavior                                                                            | Plugin bugs                    | Both are thin adapters over one service layer; contract tests assert parity for shared operations (`18_TESTING.md` §7)                                       |
| R11 | RLS misconfiguration silently disables tenant isolation backstop                                                      | Latent security gap            | Startup assertion that RLS is enabled on all tenant tables; a CI test connects as an unprivileged role and asserts cross-org reads fail                      |
| R12 | Flag sprawl leaves dead code paths                                                                                    | Maintenance drag               | Every flag has an owner and a removal condition (§9.2); architecture gate fails on expired flags                                                             |
