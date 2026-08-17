# NEXUS — Advanced Research & Intelligence Canvas

## 00 — MASTER SPECIFICATION (single source of truth)

> **Status:** Phase 0 complete (architecture frozen).
> **Audience:** the coding AI that will implement NEXUS phase by phase, and any human reviewer.
> **Rule:** every other document in `/NEXUS-SPEC` refines this file. If a document contradicts
> `00_MASTER.md`, **this file wins** and the other document must be corrected in the same PR.

---

## 1. Executive summary

NEXUS is a **desktop-class web application for visual research**: an infinite canvas where an
analyst collects URLs, pages, images, documents, notes, identities and repositories, links them
into a typed graph, runs open-source research tooling against them, and exports the result as a
defensible investigation report.

It is not a whiteboard with cards. The canvas is a **rendering surface over a typed knowledge
graph**. Every card is an entity with provenance (where it came from, which tool produced it,
when, with what confidence). Every line is a typed relationship. The same graph can be viewed as
canvas, force graph, timeline, table, list or map without duplicating data.

Three properties define the product and are non-negotiable:

1. **Provenance-first.** No node exists without a source. Tool-created nodes always carry
   `source`, `tool`, `run_id`, `observed_at`, `confidence`, and a link to the raw payload.
2. **Deterministic performance.** 5,000 nodes / 10,000 edges at 60 fps pan-zoom on a 2020-class
   laptop, verified by an automated benchmark in CI — not by feel.
3. **Nothing silently changes data.** Every automatic action (AI suggestion, tool import,
   auto-layout) is _previewable, reversible and explainable_.

---

## 2. Final architecture decision (frozen)

| Layer             | Decision                                                                                                                                                                                                             | One-line justification                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language          | **TypeScript 5.6+, strict**, everywhere                                                                                                                                                                              | one type language across client, server, plugins                                                                                                                                                    |
| Frontend shell    | **React 19 + Vite 6** SPA (not Next.js)                                                                                                                                                                              | app is behind auth, has no SEO surface, needs fast HMR on a heavy canvas                                                                                                                            |
| Canvas renderer   | **Custom hybrid engine**: Canvas2D (edges, far-LOD nodes, grid, marquee) + **DOM overlay for visible, near-zoom nodes** + spatial index                                                                              | React Flow degrades past ~500 rich DOM nodes; pure WebGL loses rich text/HTML cards. Hybrid keeps HTML fidelity where the user looks and canvas speed everywhere else. See `05_CANVAS_ENGINE.md` §2 |
| Scene state       | **Yjs `Y.Doc` per board** = the document; **Zustand** = ephemeral UI state only                                                                                                                                      | CRDT gives offline-first + realtime + conflict-free merge with one model; UI state must never be persisted                                                                                          |
| Undo/redo         | **`Y.UndoManager`** scoped to the local origin                                                                                                                                                                       | free, correct across concurrent edits; hand-rolled command stacks break under sync                                                                                                                  |
| Local persistence | **`y-indexeddb`** + file blobs in **OPFS**                                                                                                                                                                           | app opens instantly and works fully offline                                                                                                                                                         |
| Sync              | **Hocuspocus 4** WebSocket server, one room per board, Redis extension for horizontal scale                                                                                                                          | official Yjs server, auth hooks, awareness, battle-tested                                                                                                                                           |
| Backend API       | **Fastify 5** (Node 22 LTS) + **tRPC v11** for the app, REST (OpenAPI) for plugins/webhooks                                                                                                                          | typed end-to-end for our own client, standards-based for third parties                                                                                                                              |
| Database          | **PostgreSQL 16** + **Prisma**                                                                                                                                                                                       | relational core (projects, ACL, runs, audit) + `jsonb` for flexible node payloads + `pgvector` for embeddings                                                                                       |
| Graph storage     | **Postgres tables (`nodes`, `edges`) as the queryable projection**, Yjs binary as the authoritative live document                                                                                                    | one database; recursive CTEs cover the graph queries we need, no second DB to operate                                                                                                               |
| Search            | **Postgres FTS + `pg_trgm`** (phase 7), **pgvector** semantic search (phase 11)                                                                                                                                      | avoids a second search cluster until scale demands it                                                                                                                                               |
| Files             | **S3-compatible object storage** (MinIO in dev), presigned uploads, server-side type sniffing                                                                                                                        | never trust client MIME                                                                                                                                                                             |
| Jobs              | **BullMQ + Redis**                                                                                                                                                                                                   | integration runs, link unfurling, thumbnails, repo analysis                                                                                                                                         |
| Tool execution    | **Runner service** executing every tool in a locked-down container (`--network` allowlist proxy, `--read-only`, `--cap-drop ALL`, non-root, pids/mem/cpu caps, hard timeout); **gVisor runtime class in production** | tools are untrusted third-party code; container flags + user-space kernel are the practical 2026 baseline                                                                                           |
| Auth              | **Better-Auth** (email + OAuth) with sessions in Postgres, org/project RBAC                                                                                                                                          | mature, self-hostable, no vendor lock                                                                                                                                                               |
| AI layer          | Provider-abstracted (`AIProvider` interface), default OpenAI-compatible endpoint; **all writes go through a Proposal object**                                                                                        | model choice must be swappable; AI never mutates the graph directly                                                                                                                                 |
| Styling           | **CSS custom properties (design tokens) + Tailwind v4 preset generated from the tokens**                                                                                                                             | one token source, light theme later without touching components                                                                                                                                     |
| Component base    | **Radix primitives**, all skinned; zero default browser controls                                                                                                                                                     | accessibility for free, full visual control                                                                                                                                                         |
| Motion            | **Motion (framer-motion 12)** for UI chrome only; canvas animates via rAF on transforms                                                                                                                              | never animate layout inside the canvas                                                                                                                                                              |
| Testing           | Vitest (unit), Playwright (e2e + visual), k6 (API load), custom canvas benchmark harness                                                                                                                             | see `18_TESTING.md`                                                                                                                                                                                 |
| Deployment        | Docker Compose (self-host reference) + Kubernetes manifests; GitHub Actions CI                                                                                                                                       | self-hostable is a requirement for OSINT users                                                                                                                                                      |

### Why this architecture (the three decisions worth arguing about)

**1. Custom hybrid canvas instead of React Flow / tldraw.**
React Flow renders each node as React DOM + SVG edges; published guidance and issue reports put
the smooth ceiling at roughly 500 rich nodes, and our nodes are _rich_ (favicons, previews, rich
text, badges). tldraw solves this with culling and a spatial index but owns its own document model
and shape system, which fights our typed-entity graph and our CRDT. So we take tldraw's proven
techniques (spatial index, culling, LOD, stable zoom during camera movement) and implement them
against **our** data model. Concretely: nodes outside the viewport are not mounted at all; below
`zoom < 0.55` nodes are painted on canvas as LOD glyphs; edges are always canvas; only the
visible, near-zoom set becomes DOM. This is the only approach that gives both 5,000-node
performance and pixel-perfect rich cards. Full analysis and rejected alternatives:
`05_CANVAS_ENGINE.md`.

**2. Yjs as the document, Postgres as the projection.**
Requirements 21 (persistence), 22 (offline-first) and collaboration are the same problem. A CRDT
solves all three at once, and `Y.UndoManager` also solves undo/redo under concurrency. The cost is
that CRDT binary is not queryable — so the Hocuspocus persistence hook **projects** every board
update into normalized `nodes` / `edges` rows in the same transaction that stores the binary
snapshot. Queries, search, exports and integrations read the projection; the client reads the CRDT.
Projection is idempotent and replayable from the binary, so it can never become the source of a
data loss.

**3. Integrations as data, not as code paths.**
Every tool (GitHub, Sherlock, SpiderFoot, future ones) is described by a **manifest** and executed
by one generic pipeline: `Input Adapter → Execution Layer → Output Parser → Entity Extractor →
Node Mapper → Relationship Mapper → Import Proposal → Canvas`. The application core contains zero
tool-specific code. Adding a tool is adding a manifest + a parser module in `packages/integrations`,
never a change to the canvas. See `10_INTEGRATIONS.md` and `17_PLUGIN_SDK.md`.

---

## 3. Product principles

1. **The canvas explains itself.** Every affordance is discoverable without documentation:
   empty states teach, hovering reveals, `Ctrl+K` lists everything the app can do.
2. **Paste is the front door.** `Ctrl+V` must always produce the right node type. Collection is
   frictionless; structure comes later.
3. **Structure is earned, not demanded.** The user may stay messy; the system offers structure
   (auto-layout, clustering, duplicate detection) and never enforces it.
4. **Every claim has a source.** Analyst work is only worth what its provenance supports.
5. **Calm interface.** Dark, quiet, high-contrast where it matters; no neon, no glow, no noise.
6. **Legal by design.** The product targets authorized research: own assets, public data,
   permitted engagements. See `15_SECURITY.md` §9 (acceptable use enforcement).

---

## 4. Non-negotiable requirements

| #   | Requirement                                                                                                                        | Verified by                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| N1  | 5,000 nodes / 10,000 edges: pan-zoom p95 frame ≤ 16.6 ms, first interactive ≤ 2.5 s                                                | `bench/canvas.bench.ts` in CI, fails the build on regression                       |
| N2  | No data loss: every mutation is durable locally within 100 ms, server-acked within 2 s, `Saved / Saving… / Offline` always visible | Playwright offline suite + kill-tab test                                           |
| N3  | Undo/redo works for every mutation including tool imports and AI actions                                                           | e2e matrix, one case per mutation type                                             |
| N4  | No AI or tool output enters the graph without an explicit user-accepted **Proposal**                                               | e2e + code-level lint rule (`no-direct-graph-write` outside `applyProposal`)       |
| N5  | Every tool runs inside the sandboxed runner; no tool ever executes in the API process                                              | architecture test: runner is a separate service, API has no `child_process` import |
| N6  | Full keyboard operability, visible focus, `prefers-reduced-motion` honored, contrast ≥ 4.5:1 for text / 3:1 for UI                 | axe-core in CI + manual checklist per phase                                        |
| N7  | SSRF-safe URL handling for every user-supplied URL (DNS re-resolution pinning, private-range denylist, redirect cap)               | unit tests with a hostile URL corpus                                               |
| N8  | Every destructive action is undoable or confirmed; nothing is deleted silently                                                     | e2e                                                                                |
| N9  | Board export/import round-trips losslessly (`JSON v1` schema)                                                                      | property test: export → import → deep-equal                                        |
| N10 | No `TODO` for core functionality; every core feature has a full architectural solution                                             | PR review gate                                                                     |

---

## 5. System map

```text
┌──────────────────────────────── Client (browser) ─────────────────────────────────┐
│ UI Layer          React 19 · Radix · design tokens · command palette · panels     │
│ Canvas Engine     scene graph · spatial index · renderer (canvas + DOM overlay)   │
│                   interaction FSM · camera · edge router (worker)                 │
│ Domain Layer      entities · edge semantics · proposals · selection · history     │
│ Data Layer        Y.Doc · y-indexeddb · OPFS blobs · tRPC client · sync status    │
└───────────────────────────────────┬───────────────────────────────────────────────┘
                                    │ WebSocket (Yjs) + HTTPS (tRPC/REST)
┌───────────────────────────────────┴───────────────────────────────────────────────┐
│ Sync Service (Hocuspocus)   auth hook · awareness · Redis fanout · projection hook │
│ API Service (Fastify+tRPC)  projects · boards · files · search · runs · admin      │
│ Worker Service (BullMQ)     unfurl · thumbnails · repo analysis · AI jobs          │
│ Runner Service              manifest-driven sandboxed tool execution (gVisor)      │
│ Storage                     Postgres 16 (+pgvector) · Redis · S3/MinIO             │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Layer boundaries are enforced by dependency-cruiser rules (`19_DEPLOYMENT.md` §6):
UI may import Domain; Domain may not import UI; Canvas Engine may not import React;
Data Layer may not import Canvas Engine.

---

## 6. Monorepo layout

```text
/
├─ apps/
│  ├─ web/                 React SPA (Vite)
│  ├─ api/                 Fastify + tRPC + REST
│  ├─ sync/                Hocuspocus server + projection
│  ├─ worker/              BullMQ consumers
│  └─ runner/              sandboxed integration executor
├─ packages/
│  ├─ canvas-engine/       framework-agnostic renderer + interaction FSM (no React)
│  ├─ domain/              entity/edge types, zod schemas, proposal logic, graph algorithms
│  ├─ ui/                  design tokens, primitives, icons, motion presets
│  ├─ integrations/        manifests + adapters (github, sherlock, spiderfoot, …)
│  ├─ plugin-sdk/          public types + host API for third-party plugins
│  ├─ db/                  Prisma schema, migrations, seed
│  └─ config/              eslint, tsconfig, vitest, tailwind preset
├─ bench/                  performance harnesses
├─ e2e/                    Playwright suites
├─ infra/                  docker-compose, k8s, gVisor runtime class, CI
└─ NEXUS-SPEC/             this specification
```

Dependency direction: `apps/*` → `packages/*`; `packages/canvas-engine` and `packages/domain`
depend on nothing internal except `packages/config`.

---

## 7. Implementation order (phases)

Each phase has a self-contained implementation prompt in `20_ROADMAP.md` and ships behind a
quality gate (§8). Order optimizes for "the risky, architecture-defining parts first".

| Phase | Name                          | Ships                                                                          |
| ----- | ----------------------------- | ------------------------------------------------------------------------------ |
| P0    | Architecture                  | this spec (done)                                                               |
| P1    | Foundation                    | monorepo, tokens, app shell, auth, Postgres, CI, benchmark harness             |
| P2    | Canvas engine                 | camera, spatial index, hybrid renderer, selection, drag, grid, minimap         |
| P3    | Document & persistence        | Y.Doc schema, IndexedDB, undo/redo, save indicator, snapshots                  |
| P4    | Node system                   | all node types, inspector, rich text, files, images, tags                      |
| P5    | Edge system                   | typed edges, routing modes (curved/orthogonal/straight/smart), labels, editing |
| P6    | Capture                       | paste pipeline, drag-drop, unfurl service, quick-add, browser extension hook   |
| P7    | Projects & search             | multi-project, boards, global search, `Ctrl+K` command palette                 |
| P8    | Sync & collaboration          | Hocuspocus, projection, presence, comments, conflict UX                        |
| P9    | Integration framework         | manifest schema, runner sandbox, proposal/import UX, run history               |
| P10   | GitHub integration            | repo nodes, README/releases/contributors, repo analysis agent                  |
| P11   | Sherlock integration          | username enumeration → entity mapping                                          |
| P12   | SpiderFoot integration        | scan orchestration → entity mapping, correlation import                        |
| P13   | AI layer                      | summarize, explain, suggest links, dedupe, cluster, investigation summary      |
| P14   | Views                         | graph / timeline / table / list / map modes, auto-layout suite                 |
| P15   | Groups, presentation & export | groups, presentation mode, report export, archives                             |
| P16   | Hardening                     | performance pass, security audit, a11y audit, observability, GA                |

---

## 8. Quality gate (applies to every phase, no exceptions)

A phase is **done** only when all seven checks pass and the evidence is in the PR body:

1. **Functional** — every acceptance criterion of the phase prompt demonstrably works.
2. **UX** — the primary flow is completable without documentation; empty, loading, error and
   success states exist for every new surface.
3. **Visual** — matches `04_DESIGN_SYSTEM.md`; zero hardcoded colors/spacings; Playwright visual
   snapshots updated and reviewed.
4. **Performance** — `bench` shows no regression beyond 5% against the previous tag; N1 holds.
5. **Security** — new inputs validated with zod at the boundary; new external calls SSRF-guarded;
   `npm audit --omit=dev` clean of high severity; threat notes for anything new in
   `15_SECURITY.md`.
6. **Architecture** — no layer violations (dependency-cruiser green), no duplicate implementation
   of an existing capability, public types documented.
7. **Tests** — unit tests for logic, e2e for the flow, and the phase's acceptance table encoded as
   tests. Coverage on `packages/domain` and `packages/canvas-engine` ≥ 85% lines.

Every phase PR must also state: _what existed before, what was reused, what was intentionally not
touched._ Rewriting a working subsystem without a stated reason is a gate failure.

---

## 9. Document index

| File                  | Contains                                                                         |
| --------------------- | -------------------------------------------------------------------------------- |
| `00_MASTER.md`        | this file — decisions, principles, phases, gates                                 |
| `01_PRODUCT.md`       | vision, users, jobs-to-be-done, feature set incl. the 20+ self-proposed features |
| `02_ARCHITECTURE.md`  | layer contracts, module boundaries, runtime topology, key sequences              |
| `03_UX.md`            | full interaction specification, state-by-state, shortcuts, error copy            |
| `04_DESIGN_SYSTEM.md` | token architecture, color/type/space scales, component variants                  |
| `05_CANVAS_ENGINE.md` | renderer, camera, spatial index, LOD, interaction FSM, performance budget        |
| `06_NODE_SYSTEM.md`   | node type registry, schemas, editors, lifecycle                                  |
| `07_EDGE_SYSTEM.md`   | edge semantics, routing algorithms, labels, editing                              |
| `08_DATA_MODEL.md`    | Y.Doc schema, Postgres schema, indexes, migrations, export format                |
| `09_BACKEND.md`       | services, APIs, jobs, files, observability                                       |
| `10_INTEGRATIONS.md`  | manifest schema, runner sandbox, pipeline, proposals                             |
| `11_GITHUB.md`        | GitHub integration + repository analysis agent                                   |
| `12_SPIDERFOOT.md`    | SpiderFoot adapter, risks, entity mapping                                        |
| `13_SHERLOCK.md`      | Sherlock adapter, entity mapping                                                 |
| `14_AI_AGENT.md`      | AI layer, proposal model, prompts, guardrails, cost control                      |
| `15_SECURITY.md`      | authn/z, isolation, SSRF, files, secrets, audit, acceptable use                  |
| `16_PERFORMANCE.md`   | budgets, techniques, measurement, regression gates                               |
| `17_PLUGIN_SDK.md`    | plugin manifest, permissions, extension points, lifecycle, sandbox               |
| `18_TESTING.md`       | test strategy, layers, fixtures, visual and performance testing                  |
| `19_DEPLOYMENT.md`    | environments, IaC, CI/CD, migrations, backup, monitoring                         |
| `20_ROADMAP.md`       | phase-by-phase implementation prompts (P1…P16)                                   |

---

## 10. Rules for the implementing AI

1. **Read before writing.** Inspect the existing code and the relevant spec document first.
   Never re-implement something that already exists in `packages/`.
2. **One phase per PR.** Do not start the next phase inside the current one.
3. **Never break what works.** If a change forces a breaking refactor, state it in the PR and
   update the affected spec document in the same PR.
4. **Types and docs are part of the change.** Public API changes update `packages/*/README.md`
   and the relevant `NEXUS-SPEC` file.
5. **No generic errors.** Every failure surfaces _what happened, why, what to do_ (see
   `03_UX.md` §12).
6. **No hardcoded design values.** Colors, spacing, radii, durations come from tokens only.
7. **Bug prevention checklist** before finishing any phase: race conditions, stale closures,
   duplicate listeners, leaked rAF/observers/workers, unbounded memory, expensive re-renders,
   broken undo, broken persistence, lost clipboard payloads, malformed URLs, oversized files,
   corrupt imports, integration timeouts.
8. **Mark progress.** When a phase completes, tick it in `20_ROADMAP.md` and in the root
   roadmap file the project owner maintains.
