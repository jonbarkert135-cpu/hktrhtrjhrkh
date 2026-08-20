# Raven — 20 — IMPLEMENTATION ROADMAP (open phases + shipped ledger)

## Scope

This file is the executable plan for **work that is still open**. Each open phase is one
self-contained implementation prompt (same 15 sections), written so a coding AI with no memory can
execute it by reading only that prompt plus the spec sections it names. Finished phases are one line
each in the **Shipped** ledger below and their prompts are deleted — keeping a 1,700-line archive of
already-built work only burns reading budget and invites re-implementation. Git history has them.

Phases P1–P16 come from `00_MASTER.md` §7; P17 and above come from the briefs in `prompts/`; the L4
layer comes from `prompts/PROMPT_4_MALTEGO_ECOSYSTEM_RU.md`. Nothing here may contradict
`00_MASTER.md`; if it does, `00_MASTER.md` wins.

---

## Architectural corrections applied outside the phase plan

**Local-first, backend-ready (2026-08-18, branch `arch/local-first`).** The product's default
deployment shape is now `APP_MODE=local`: no account, no server, no database, no network. The phase
prompts below still describe the server shape and remain correct for it — read them together with
`docs/adr/ADR-001-local-first.md`, which states the two-shape rule, and `docs/backend/BACKEND_STATUS.md`,
which records what of the backend is built, dormant or missing. Concretely, when a phase prompt says
"call the API", the correct implementation is a method on `WorkspaceRepository`
(`apps/web/src/data/workspace/types.ts`) with both a local and a server implementation. Backend API
and auth themselves are foundational (P1, shipped — `apps/api/src/auth`) and already dormant-but-green
in local mode per `BACKEND_STATUS.md`. **Correction (this PR):** an earlier draft of this note called
P9 "backend API & auth", contradicting `00_MASTER.md` §7, where P9 is the **integration framework**
(manifest schema, runner sandbox, proposal/import UX, run history) — `00_MASTER.md` wins, and P9's
prompt below is the integration framework. P8 (sync) and P9 (integrations) are the phases that switch
a _new_ server capability on (`cloudSync`/`collaboration`, and `integrations` respectively); neither
becomes a prerequisite for anything that shipped before it.

---

## How to use these prompts

1. **Pick the lowest un-ticked phase in the progress tracker (§ bottom)** whose dependencies are
   ticked. Do not start two phases at once (`00_MASTER.md` §10.2).
2. **Read, in this order:** `00_MASTER.md` (whole file), then the spec documents listed in the
   phase's section 3, then the existing code in the paths listed in section 4. Never write code
   before reading the existing implementation of the modules you will touch.
3. **Re-use before you build.** If a capability exists in `packages/`, extend it. Rewriting a
   working subsystem without a written reason is an automatic gate failure.
4. **Work test-first for domain logic.** The tests named in section 11 are part of the deliverable,
   not an afterthought; `18_TESTING.md` defines conventions, factories and the per-phase checklist.
5. **Stop at the phase boundary.** If you discover work belonging to a later phase, write it into
   that phase's section 2 ("Context") as a note and move on. Do not implement it.
6. **Finish by ticking the tracker** in this file and filling the PR template evidence
   (`18_TESTING.md` §16 + `00_MASTER.md` §8).

### Branch and PR convention

```text
branch:  phase/p<nn>-<slug>              e.g. phase/p05-edge-system
commits: conventional commits            e.g. feat(edges): orthogonal router with obstacle padding
PR title: P<nn> — <Phase name>
PR body (required sections):
  ## What existed before
  ## What was reused
  ## What was intentionally not touched
  ## Acceptance criteria evidence      (one line per criterion, with proof: test name / screenshot)
  ## Test evidence                     (paste the checklist from 18_TESTING.md §16)
  ## Spec documents updated
  ## Risks introduced
```

One phase per PR. A PR that touches files outside its section 4 list must justify each extra file
in "What was intentionally not touched" (inverted: say why it had to change).

### Quality gate reminder (`00_MASTER.md` §8 — all seven, evidence in the PR body)

Functional · UX (empty/loading/error/success on every new surface) · Visual (tokens only, snapshots
reviewed) · Performance (bench ≤ 5 % regression, N1 holds) · Security (zod at boundaries, SSRF
guards, audit clean) · Architecture (dependency-cruiser green, no duplicate capability) ·
Tests (unit + e2e + acceptance table encoded; `packages/domain` and `packages/canvas-engine`
≥ 85 % lines).

Non-negotiables N1–N10 (`00_MASTER.md` §4) apply to **every** phase, not only the phase that
introduced them. If a phase breaks a non-negotiable, the phase is not done.

---

## Shipped (do not re-implement)

This file carries prompts for **remaining** work only. The implementation prompts of finished phases
were deleted once shipped — they are in git history, and the binding description of what exists is
the area spec plus the code. Read `AGENTS.md` first.

| Phase                | PRs                | Where it lives now                                                                                                                                          | Spec                                |
| -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| P1 Foundation        | #2                 | monorepo, tokens, app shell, CI, bench harness                                                                                                              | `00_MASTER.md`, `19_DEPLOYMENT.md`  |
| P2 Canvas engine     | #3                 | `packages/canvas-engine` (camera, spatial index, FSM, renderer)                                                                                             | `05_CANVAS_ENGINE.md`               |
| P3 Document          | #4, #5             | `packages/domain` (board doc, patches, undo, autosave), `apps/web/src/data`                                                                                 | `08_DATA_MODEL.md`                  |
| P4 Node system       | #6, #7, #8         | `packages/domain/src/nodes`, `apps/web/src/nodes` (9 types, inspector, hosts)                                                                               | `06_NODE_SYSTEM.md`                 |
| P5 Edge system       | #11, #12, #17, #23 | edge taxonomy, 4 routing modes + cache, ports, selection, relationship UI, waypoints, flow animation, bundling                                              | `07_EDGE_SYSTEM.md`                 |
| Local-first          | #9, #10, #13, #14  | `APP_MODE=local`, `WorkspaceRepository`, local persistence, first-run seed                                                                                  | `docs/adr/ADR-001-local-first.md`   |
| L4.1 Transforms      | #15                | `packages/transforms` (manifests, registries, router, modes, scores, planner, catalogue)                                                                    | `21_TRANSFORM_SYSTEM.md`            |
| L4.2 Transform SDK   | #20                | `packages/transforms/src/sdk` (engine contract, `runEngine` host, testkit, conformance harness, `doh-resolver` reference engine)                            | `21_TRANSFORM_SYSTEM.md` §12a       |
| L4.3 Run history     | #21                | `packages/transforms/src/history.ts`, `src/cache.ts` (history, replay, compare, TTL cache)                                                                  | `21_TRANSFORM_SYSTEM.md` §10        |
| Layer-2 docs         | #16                | `22_ECOSYSTEM_AUDIT.md`, `23_COMPETITOR_MATRIX.md`, `24_UNIFIED_QUERY.md` (design only)                                                                     | those documents                     |
| P6 Capture           | #22                | `packages/domain/src/{capture,net}`, `apps/web/src/capture`, `apps/api/.../unfurl.ts` — §5.12/§5.14 still open                                              | `09_BACKEND.md`, `15_SECURITY.md`   |
| P7 Projects & search | #25                | `packages/domain/src/{search,templates}`, `apps/api/.../{project,board}.ts`, `apps/web/src/{projects,app/commands,search}` — §6/§2 (partial)/§11 still open | `09_BACKEND.md`, `03_UX.md` §8–9    |
| P8 Sync & collab     | #24                | `apps/sync` (Hocuspocus, projection, presence, eviction), `apps/web/src/collab`, `packages/domain/src/projection`                                           | `09_BACKEND.md`, `08_DATA_MODEL.md` |
| Agent memory         | #18                | `AGENTS.md`, `.mcp.json`                                                                                                                                    | —                                   |

Open phases in this file: **P9**, **P10**, **P17**, **L4.4–L4.7**, plus the two deferred P6 items and
the remaining P7 items (§6 global search, §2 member management, §11 thumbnails, §3 move-board
picker, §10 virtualization, §14 UI disclosure). P11–P16 have short scope stubs below the P10 prompt;
write their full 15-section prompt in this format when their turn comes, expanding the stub rather
than discarding it.

---

# P6 — Capture

**Status: mostly shipped (see the ledger). Still open, and why:**

- §5.12 browser-extension hook `POST /api/v1/capture` — needs scoped API tokens (a `db` model, a
  migration and a hash-at-rest scheme, `09_BACKEND.md` §4.1), which **P9** introduces for its own
  REST v1 surface (`/v1/runs`, `10_INTEGRATIONS.md` §10); the domain side is ready
  (`createNodesFromPlan` already accepts `origin: 'extension'`).
- §5.14 screenshot capture — needs a headless browser in `apps/worker`, which does not exist. The
  flag is not introduced, so there is no dead control (which is what §5.14 actually asks for).
- The unfurl **queue**: `apps/worker` does not exist, so the unfurl runs in-request behind the same
  contract (`09_BACKEND.md` §3.6a). The client does not wait on it — nodes are created locally.
- Web ⇄ unfurl wiring: in `APP_MODE=local` there is no server to ask, so no capture path calls it
  (N2). Connecting the website card to `unfurl.fetch` belongs with the server-mode work.

## Remaining requirements (the only P6 work left)

12. Browser-extension hook: `POST /api/v1/capture` accepting `{ url, title?, selection?, imageUrl?,
boardId? }` authenticated by a scoped API token; it creates a node in the target board's inbox
    area (a reserved region 2,000 px left of the origin) and returns the node id. Rate limit 60/min.
13. Screenshot capture of a website node behind the `capture.screenshot` feature flag (off by
    default); when off the UI does not offer it (no dead controls).

Do both together with **P9**, which brings scoped API tokens and `apps/worker`. Everything else
from the original P6 prompt is shipped in PR #22 — read `packages/domain/src/{capture,net}`,
`apps/web/src/capture`, `apps/api/src/trpc/routers/unfurl.ts` plus `09_BACKEND.md` and
`15_SECURITY.md` instead of the deleted prompt.

---

# P7 — Projects & search

**Status: mostly shipped. Still open, and why:**

- §6 global search (Postgres FTS + `pg_trgm`, `websearch_to_tsquery`, `ts_headline`, permission-
  scoped) — the roadmap's own §2 context note says the projection this needs (`nodes`/`edges` in
  Postgres) does not exist yet and is P8's job (the sync service owns the projection). This phase
  ships the **local-only** search path only, exactly as §2 scoped it, and defers §6/§7's
  server-merge half to P8.
- §2 project member management (invite by email, per-project roles, remove) — no project-scoped
  membership model exists (only the org-level `Membership` role, `09_BACKEND.md` §3.1), and invites
  need a mailer that is not built. Reuses the org role for authorization today; a project-scoped
  membership model belongs with the auth/backend phase (P9) that can add the mailer and the invite
  token model together.
- §11 worker-generated thumbnails (refreshed every ≤10 min) — needs `apps/worker`, which does not
  exist (same gap P6 §5.14 hit). The grid shows a deterministic per-board placeholder instead of a
  stub or a dead control.
- §3 "move board to another project" has no picker UI yet; `WorkspaceRepository.moveBoard` and the
  `board.move` procedure are shipped and tested, just not wired to a menu control.
- §10 perf requirement (board grid virtualized above 60 cards, k6 `search` scenario @ 1M nodes) —
  the grid pages in slices of 60 ("Show more") rather than a virtualization library; the k6 scenario
  has no server search to test yet (see the first bullet). e2e journeys J15/J16/J20 and
  `a11y/palette-keyboard.spec.ts` were not run in the implementing sandbox (no seeded Postgres, no
  confirmed Playwright browser binaries) — write these before merging into a environment that has
  both.
- P7 §14's undo-semantics disclosure ("board metadata operations are not in the CRDT undo stack;
  state this explicitly in the UI") is not yet surfaced anywhere in the UI copy.

## Remaining requirements (the only P7 work left)

- **§6** Global search (server): Postgres FTS + `pg_trgm`, permission-filtered, merged into local
  results with a "N more from other boards" divider. Do this with P8, once the projection exists.
- **§2** Project member management: invite by email, per-project roles, remove — do this with P9
  (backend/auth), which is what gives an invite flow a mailer and a place to verify tokens.
- **§11** Worker-generated board thumbnails, refreshed on a snapshot cadence — do this once
  `apps/worker` exists (same dependency as P6 §5.14/§5.12).
- **§3** "Move to another project" picker UI on top of the already-shipped `moveBoard` procedure.
- **§10** Board-grid virtualization above 60 cards (a real virtualization library, not
  page-slicing) once boards-per-project counts in the thousands are a realistic target.
- **§14** The "operations on board metadata are not undoable with Ctrl/Cmd+Z" disclosure in the UI
  (rename/archive/delete dialogs), plus the deferred e2e journeys (J15/J16/J20,
  `palette-keyboard.spec.ts`).

Everything else from the original P7 prompt is shipped: data model (`Board`/`Project` columns +
migration `0004_project_board_management`), project/board CRUD + audit + authz
(`apps/api/src/trpc/routers/{project,board}.ts`), the three built-in templates
(`packages/domain/src/templates/boardTemplates.ts`), local search
(`packages/domain/src/search/{tokenize,score,localIndex,boardIndex}.ts`), the board grid with
filters/menus (`apps/web/src/projects/{BoardGrid,BoardCard}.tsx`), the command palette with all six
modes and menu-command parity (`apps/web/src/app/commands/{registry,palette}.tsx`), camera-jump +
highlight pulse, and viewer-role control gating — read those paths plus `09_BACKEND.md` and
`03_UX.md` §8–9 instead of the deleted prompt.

---

# P8 — Sync & collaboration

**Status: mostly shipped (PR #24, merged). Still open, and why:**

- §5.13 rich-text character-wise merge and delete-vs-edit undo recovery, and the observer-based
  edge-pruning on both replicas — verified only by unit tests; the live e2e/concurrency proof needs
  a running Postgres + Redis + `apps/sync` stack (CI has it, this sandbox did not). The mechanism
  (Yjs `Y.XmlFragment` CRDT merge, `UndoManager` origin scoping) already exists from P3/P4; nothing
  new to build, only to verify under load.
- The full `e2e/collab/*` suite, `load/sync-fanout.js` (k6) and the broadcast-latency/memory
  performance numbers of the original §10 — same reason as above; specs, fixtures and the
  unit-testable halves are done.
- `08_DATA_MODEL.md` §5's `groups`/`node_tags`/`entity_resolutions`/`history_events`/embedding-job
  projection is a superset this phase did not implement — the shipped projection covers
  `nodes`/`edges`/`board_snapshots`/`comments`/`presence_log` only; the richer surface is a tracked
  deviation, not a new phase.
- Comments follow the simpler "Postgres row, doc holds only the anchor id" design
  (`08_DATA_MODEL.md` §5.10) instead of the original Y.Map-subdoc sketch — deliberate, see the PR.
- Mentions email delivery is stubbed (`apps/api/src/mentions.ts`'s `EmailSink`) — there is no mailer
  in this codebase yet (P1 deferred the same for signup); rate-limit/digest logic is built and
  tested, swapping in a real transport is a one-line change once a mailer lands.
- `apps/web/src/data/syncProvider.ts` and `apps/web/src/collab/*` are built and unit-tested standing
  alone, but were deliberately **not wired into** `BoardDocProvider` (`docProvider.tsx`) or the board
  canvas overlay while `phase/p07-projects-search` (PR #25) restructures the same area concurrently.
  Wiring them in is a small, well-defined follow-up once P7 lands — track it as the first item of
  whichever phase next touches `docProvider.tsx` (P9 does not; note it in that phase's PR if it does).
- Runbooks (`runbooks/projection.md`, `sync.md`, `sync-memory.md`) and the three alert rules are
  written but not deployed to a live Alertmanager — none runs in this environment.

Everything else from the original P8 prompt is shipped in PR #24 — read `apps/sync`
(`server.ts`, `auth.ts`, `persistence.ts`, `projection.ts`, `awareness.ts`, `eviction.ts`,
`metrics.ts`), `packages/domain/src/projection`, `apps/web/src/collab`, `packages/db/prisma/schema.prisma`
(`BoardSnapshot`, `Comment`, `PresenceLogEntry` models) plus `09_BACKEND.md` §7 and `08_DATA_MODEL.md`
§3 instead of the deleted 15-section prompt.

---

# P9 — Integration framework

**Status: backend shipped on `phase/p09-integration-framework`; the web UI (§6) ships in the
companion PR.** Backend covers `packages/integrations`, `apps/runner`, `apps/worker`, the five new
tables (migration `0005_integration_framework`), the tRPC routers, REST v1 + OpenAPI, scoped API
tokens, the `integrations` capability and the two new eslint rules. Deliberately deferred, with the
reason:

- **§6 UX** (picker, consent dialog, run panel, proposal review, run history) and the client-side
  Applier wiring into `BoardWorkspace` — the second subagent's PR; `apps/web/src/data/workspace/runs.ts`
  ships here as the capability-gated seam that throws in local mode.
- **`integration_policies`** (§4.4) and therefore the `awaiting_approval` state: the enum, schema and
  state model exist, but no manifest can request an approver until the org policy surface lands.
- **e2e** (`e2e/integrations/*.spec.ts`) and **k6** (`load/integration-queue.js`): both need a live
  Postgres + Redis + runner stack, which this environment does not have; the runner's own suites
  cover the same behaviour at unit level.
- **Hostile-image sandbox suite** is written (`apps/runner/test/sandbox.hostile.test.ts`) and skips
  by name where Docker or `raven/test-hostile` is absent — CI's docker job runs it for real.
- Deviations from `10_INTEGRATIONS.md` are recorded in that document's own §15 status note.

## 1 Objective

Ship the generic, tool-agnostic integration pipeline that every future tool plugs into: the
`IntegrationManifest` schema and loader, the eight-stage pipeline (`InputAdapter → ExecutionLayer →
OutputParser → EntityExtractor → NodeMapper → RelationshipMapper → ImportProposal → Applier`), the
sandboxed `apps/runner` service, `apps/worker` (introduced in this phase) for the CPU-heavy parse
stages, run history with replay/diff, the consent/legal gate, and scoped API tokens for the new
REST v1 surface. No concrete third-party tool ships in this phase — it is proven end-to-end with the
one `builtin` (in-process, no container) integration named in `10_INTEGRATIONS.md` §3.3: `expand-url`
(follows redirects on a pasted/short URL and proposes the canonical URL). GitHub (P10), Sherlock
(P11) and SpiderFoot (P12) are manifests + parsers added on top without touching this phase's code.

## 2 Context (what exists now)

P1 shipped `apps/api` with Better-Auth sessions and org/project RBAC (`orgProcedure`); P3/P4 gave the
board its Y.Doc, undo (`Y.UndoManager`), node registry and `no-direct-graph-write` eslint rule; P6
shipped the capture pipeline and `safeFetch`/URL policy (`packages/domain/src/{capture,net}`) that
this phase reuses for `expand-url` and will reuse for every future tool's URL inputs; P7 (merged in #25)
adds projects/boards/search — this phase's run history is scoped by the same
`project_id`/`board_id` and must not assume P7 has landed (read the PR before touching
`apps/api/src/trpc/routers/*`, since it may already have moved things). P8 shipped `apps/sync`,
Hocuspocus, and the Postgres projection (`BoardProjectionNode`/`BoardProjectionEdge`,
`packages/domain/src/projection`) — this phase's `Applier` (stage 8 of the pipeline) runs
**client-side** against the local `Y.Doc` for the local caller, and reuses `apps/sync`'s existing
server-side apply path (`10_INTEGRATIONS.md` §10: `POST /v1/proposals/:id/apply` "goes through the
same Applier running in `apps/sync`") for headless/API callers — do not build a second write path.

No `packages/integrations`, `apps/runner` or `apps/worker` exist yet. No `integration_runs`,
`import_proposals`, `consents` or `api_tokens` tables exist. `packages/config/src/appMode.ts` has no
`integrations` capability.

## 3 Existing architecture to respect

- `10_INTEGRATIONS.md` — the primary reference, **all sections**; this phase implements it as
  written. Do not redesign the pipeline, the manifest schema or the error taxonomy — they are
  already fully specified there, including the zod schema (§4.1), the runner container flag
  baseline (§6.3), the egress allowlist proxy (§6.4) and the job protocol (§6.5).
- `09_BACKEND.md` §4.1 (scoped API token format `nxs_` + 32 random bytes base62, argon2id-hashed,
  scopes incl. `runs:read`, `runs:start`) and §4.2 (endpoint list) — this phase builds
  `auth.createApiToken` and the bearer-token middleware for the first time; `runs:*` scopes are
  added here, the rest of the scope list is reused as-is.
- `15_SECURITY.md` §4 (input validation boundary table — REST v1 row), §6 (SSRF), §9 (sandbox
  container baseline is cross-referenced from `10_INTEGRATIONS.md` §6.3, do not duplicate it).
- `docs/adr/ADR-002-feature-flags.md` — this phase adds one row: `integrations: 'INTEGRATIONS_ENABLED'`
  requiring `backend` (same shape as `cloudSync`/`collaboration`). In `APP_MODE=local` the entire
  integrations surface — manifests, run button, run history panel — is **absent**, not disabled;
  follow `apps/web/src/app/localMode.test.tsx`'s existing pattern (N2). This decision is new in this
  phase (neither `10_INTEGRATIONS.md` nor the ADRs stated it) because tool execution is inherently
  server-side (N5: sandboxed runner, never in-process) and cannot have a meaningful local-only mode.
- `18_TESTING.md` §7 (architecture tests), §11.3 (authz matrix), §16 (PR evidence checklist).
- `00_MASTER.md` N4 (propose-never-write), N5 (sandboxed execution), N7 (SSRF), N9 (export
  round-trip — `import_proposals`/`integration_runs` rows must survive board export/import).

## 4 Files/modules affected

```text
packages/integrations/src/
  index.ts, manifest.ts, pipeline.ts
  extract/{normalizers.ts,patterns.ts,confidence.ts}
  resolve/{identity.ts,merge.ts}
  errors.ts
  testkit/
packages/integrations/builtin/{manifest.ts,parser.ts}       -- expand-url, the one shipped manifest
apps/runner/src/
  main.ts, executors/{container.ts,http.ts,builtin.ts,builtin-registry.ts}
  sandbox/{flags.ts,egress-proxy.ts,secrets.ts}
  artifacts.ts, runlog.ts, cancel.ts
apps/worker/src/
  main.ts                       -- BullMQ bootstrap, first consumer this codebase ships
  queues/integration.parse.ts   -- stages 3-7 of the pipeline
apps/api/src/trpc/routers/{integrations.ts,runs.ts,consents.ts,apiTokens.ts}
apps/api/src/auth/apiToken.ts               -- auth.createApiToken, bearer middleware
apps/api/openapi/integrations.yaml          -- REST v1 surface, 10_INTEGRATIONS.md §10
apps/web/src/features/integrations/{IntegrationPicker.tsx,ConsentDialog.tsx,RunPanel.tsx,
  RunHistory.tsx,ProposalReview.tsx,ApplyToast.tsx}
apps/web/src/data/workspace/runs.ts          -- WorkspaceRepository method, local shape throws
                                              -- (N2: capability-gated, see §3)
packages/db/prisma/schema.prisma             -- integration_runs, run_log_entries, import_proposals,
                                              -- consents, api_tokens (§5 below)
packages/config/src/appMode.ts               -- + `integrations` capability
.dependency-cruiser.cjs                      -- integrations-no-app rule
packages/config/eslint/rules/{no-tool-names-in-core.cjs,no-child-process-in-api.cjs}
```

## 5 Exact requirements (numbered, testable)

1. `IntegrationManifest` zod schema exactly as `10_INTEGRATIONS.md` §4.1; an invalid manifest fails
   the build-time unit test over every shipped manifest and fails again, loudly, at runtime load.
2. Pipeline stage contracts (`InputAdapter`, `ExecutionLayer`, `OutputParser`, `EntityExtractor`,
   `NodeMapper`/`RelationshipMapper`, `ImportProposal`, `Applier`) exactly as §3; `packages/integrations`
   imports only `packages/domain` and `packages/config` (dependency-cruiser `integrations-no-app`).
3. `apps/runner`: job protocol (§6.5), container flag baseline (§6.3: `--network` via allowlist
   proxy, `--read-only`, `--cap-drop ALL`, non-root, pid/mem/cpu caps, hard timeout), image supply
   chain (§6.2, digest-pinned), egress allowlist proxy (§6.4) including the DNS-rebinding defense
   shared with N7's hostile URL corpus. `builtin` executions run in the runner process without a
   container (§3.3) but through the same job protocol, timeout and cancellation path.
4. `apps/worker`: BullMQ + Redis consumer for queue `integration.parse`, running stages 3–7
   (extract → map → propose) outside the runner's container slot (§2's stated rationale: parsing a
   40 MB artifact must not halve run throughput). This is the first `apps/worker` in the codebase;
   it reuses `packages/db` and `packages/domain`, never `apps/runner`'s sandbox code.
5. `integration_runs`, `run_log_entries`, `import_proposals`, `consents` tables exactly as §5 and
   §3.7; `integration_runs.project_id`/`board_id` are RLS-scoped like every other tenant table
   (`15_SECURITY.md` §3.4).
6. Scoped API tokens: `auth.createApiToken({ name, scopes, expiresAt? })` returns the token once
   (never retrievable again), `nxs_` + 32 random bytes base62, argon2id-hashed at rest
   (`09_BACKEND.md` §4.1); bearer middleware resolves a token to its owning user and intersects
   requested scopes with the user's actual permissions per request. Scopes `runs:read`, `runs:start`
   are introduced here; the token table and middleware are the shared primitive P6's deferred
   `capture:write` scope and browser-extension endpoint will reuse without any change to this code.
7. REST v1 surface exactly as §10: `GET/POST /v1/integrations|runs|runs/:id|runs/:id/log|
runs/:id/artifacts/:name|runs/:id/cancel`, `GET /v1/proposals/:id`,
   `POST /v1/proposals/:id/apply`; `POST /v1/runs` requires a `consentToken` from
   `POST /v1/consents` (§12).
8. Run lifecycle & UX contract exactly as §7: the seven states, the run surface state table,
   progress semantics, re-run rules, diff-with-previous.
9. Entity extraction/resolution exactly as §8: normalizers, identity keys, dedupe/merge policy
   (fuzzy threshold 0.82, exposed later as an org setting per Open risk 5 — not in this phase),
   confidence model, provenance attachment (every node/edge carries `Provenance` from §3.1).
10. Error taxonomy exactly as §11 (codes, canonical user copy, retry policy, degraded modes).
11. Legal/ethical gate exactly as §12: consent recording, allowed-target policy, rate limiting,
    audit logging — nothing runs without a recorded, scoped consent (R6).
12. The one shipped manifest, `expand-url` (`execution.kind: 'builtin'`): takes a URL, follows
    redirects through `safeFetch` (`packages/domain/src/net`, P6) up to the existing redirect cap,
    and proposes updating the node's canonical URL with the final destination as a `link-expand`
    provenance entry — end-to-end proof that manifest → runner (builtin path) → worker → proposal →
    apply → undo all work before any real third-party tool exists.
13. `no-tool-names-in-core` eslint rule (R1): `apps/api`, `apps/web/src/app`, `packages/canvas-engine`
    must not reference tool identifiers; enforced now even though only `expand-url` exists, so P10–P12
    cannot regress it.
14. `no-child-process-in-api` eslint rule + architecture test mirroring the existing
    `apps/api/test/arch.no-child-process.test.ts` pattern, extended to assert `apps/runner` is the
    only package importing `node:child_process`/container-exec libraries (N5).
15. `packages/config/src/appMode.ts` gains capability `integrations` (env `INTEGRATIONS_ENABLED`,
    requires `backend`); `apps/web/src/data/workspace/local.ts`'s run-related methods throw
    (never silently no-op) so `localMode.test.tsx` catches any accidental call.

## 6 UX requirements

- Entry points exactly as §7.1: node context menu ("Run integration…"), command palette (once P7
  lands; until then a toolbar entry point suffices and is explicitly marked TODO-for-P7-merge in the
  PR, not left silent).
- Consent dialog: names the tool, the target, what data leaves the device (or "nothing, runs
  locally" for `builtin`), and requires an explicit checkbox before "Run" enables, per §12.1.
- Run panel: live state per §7.2's seven states, with a progress affordance per §7.4 (indeterminate
  until the first log line, then phase-labeled).
- Proposal review: grouped by entity kind, accept/accept-all/reject, with a "why is this here"
  provenance chip on every candidate (source integration, run id, confidence bucket).
- Run history: reverse-chronological per board, filterable by integration/status, each row links to
  its log and artifacts; re-run and diff-with-previous are one click (§7.5, §7.6).
- Errors use the canonical copy table (§11.2) verbatim — no generic "Something went wrong".
- Empty states: no integrations installed (shows `expand-url` as the always-available example), no
  runs yet, no results from a run (explains why, not just "no results").

## 7 Technical requirements

- `packages/integrations` depends only on `packages/domain`/`packages/config`; `apps/runner` and
  `apps/worker` depend on `packages/integrations`, `packages/domain`, `packages/db`, never on each
  other's internals except through the job protocol (queue payloads) and the artifact store.
- All outbound HTTP from any adapter goes through `safeFetch`/the egress allowlist proxy — never a
  bare `fetch`/`http.request` in `apps/runner` or `apps/worker`.
- Stage 8 (`Applier`) mutates the Y.Doc inside one `ydoc.transact(fn, LOCAL_ORIGIN)` so undo is one
  step per accepted proposal (N3), matching §3.7 point 1 exactly; this is enforced by the existing
  `no-direct-graph-write` rule plus a new pipeline property test (§11).
- Manifest versioning: `manifestVersion` bump requires a `migrateManifest` function shipped in the
  same PR (§14.2) — write the mechanism now even though no manifest has needed it yet.
- Every zod boundary from `15_SECURITY.md` §4.1's table applies; REST v1 body cap 1 MB except the
  multipart artifact-download redirect.

## 8 Edge cases

- Runner process crashes mid-run: run is marked `failed` with `RUNNER_CRASHED`, partial artifacts
  already uploaded remain retrievable, no orphaned container (reaper sweep in `apps/runner`).
- Worker is down: runs stay `running` (execution finished) but never reach `succeeded`/`parsing`
  completes; a stale-run monitor flags anything in `parsing` for over 10 minutes.
- A manifest declares a field type the UI can't render: registration fails at load time with the
  exact field name and reason — never a blank form.
- Two runs of the same integration/input started within the dedupe window (`input_hash`): the
  second returns the first's run id with a "using a recent identical run" notice, unless the user
  explicitly forces a re-run.
- Consent token expires between dialog confirmation and click "Run": `POST /v1/runs` returns
  `CONSENT_EXPIRED`, the dialog reopens pre-filled, no silent bypass.
- `expand-url` target is already canonical (no redirect): proposal is empty, run reports
  `succeeded` with `stats.itemsFound = 0`, not an error.
- API token used from a project the caller was removed from: `403`, not a scope error message that
  would leak the project's existence.

## 9 Security requirements

- API tokens: argon2id-hashed at rest, shown once, revocable, scoped, and a token can never exceed
  its creating user's own permissions (evaluated per request, per `09_BACKEND.md` §4.1).
- Sandbox: full container flag baseline (§6.3) verified by the hostile-image test suite named in
  §13 point 4 (write to `/` fails, exec from `/work` fails, link-local metadata IP blocked, fork
  bomb hits pid cap, 1 GiB alloc OOM-killed, 10 GiB stdout capped, secrets absent from `ps`).
- Egress proxy: DNS-rebinding corpus shared with N7; TLS is never inspected (deliberate, §Open
  risk 4 — documented, not "fixed" in this phase).
- Secrets: injected into the container environment only, never logged, never present in
  `run_log_entries` or `integration_runs.input` (redacted to `secretRef` names before storage).
- Consent and audit exactly as §12.1/§12.4; every run start, cancel and proposal apply is audited.
- `no-tool-names-in-core` and `no-child-process-in-api` are CI-enforced from this PR onward.

## 10 Performance requirements

- Queue latency: 50 concurrent runs, p95 enqueue-to-`starting` ≤ 5 s (k6 scenario named in §13.7).
- Parse stage: a synthetic 5 MB `ParsedDocument` fixture extracts + maps + proposes in ≤ 500 ms in
  `apps/worker` (bench, not a hard N-requirement, but regression-gated like N1's sibling budgets).
- `expand-url` end-to-end (queue → builtin exec → propose) ≤ 2 s p95 with a mocked redirect target.
- Runner container cold start ≤ 3 s (image already pulled); reported, not gated, in this phase.

## 11 Tests to write (named)

- `packages/integrations/test/manifest.schema.test.ts` (valid/invalid manifests, including the
  `expand-url` one; §13 point 1's five specific assertions).
- `packages/integrations/test/pipeline.property.test.ts` (§13 point 3: extract → map → propose →
  apply → undo returns the doc to a deep-equal prior state).
- `apps/runner/test/sandbox.hostile.test.ts` — the seven assertions of §13 point 4, run against a
  purpose-built `raven/test-hostile` image.
- `apps/runner/test/egress-proxy.rebinding.test.ts` (§13 point 5, DNS-rebinding corpus).
- `apps/worker/test/queue.integration-parse.test.ts` (happy, truncated, malformed fixtures per §13.2).
- `apps/api/test/apiToken.test.ts` (create, scope intersection, revoke, expiry, argon2id hash at rest).
- `apps/api/test/runs.router.test.ts` + `authz.matrix.test.ts` rows for every new procedure.
- `apps/api/test/arch.no-child-process-worker.test.ts` (extends the existing arch test to
  `apps/worker`/`apps/runner` boundaries).
- `packages/config/test/no-tool-names-in-core.rule.test.ts`.
- `e2e/integrations/expand-url-run.spec.ts` (configure → consent → run → proposal → accept → undo).
- `e2e/integrations/consent-required.spec.ts`, `e2e/integrations/runner-down.spec.ts`.
- `load/integration-queue.js` (k6, 50 concurrent runs).

## 12 Acceptance criteria (checkable)

1. Installing zero third-party tools, a user can still run `expand-url` on a pasted short URL,
   review the proposal and accept it, producing one undo step.
2. A manifest with a schema violation fails registration with a specific, actionable message and
   never appears in the picker.
3. A run started with a tampered/expired consent token is rejected server-side (`403`/`CONSENT_…`).
4. Killing the runner mid-run marks the run `failed` with a specific code; no orphaned container;
   restarting the runner drains the queue without duplicate runs.
5. `apps/api` has zero `child_process` imports and zero tool-name identifiers (CI-enforced).
6. An API token's effective permissions never exceed its creating user's; revoking it takes effect
   on the next request.
7. `expand-url` end-to-end run completes and matches the acceptance chain in requirement 12.

## 13 Definition of Done

Acceptance criteria pass; `10_INTEGRATIONS.md` has no undocumented deviation (any taken is recorded
in its own status note, mirroring how P6/P8 record theirs); `09_BACKEND.md` §4 matches the shipped
token/REST implementation; authz matrix covers every new procedure; both trackers ticked.

## 14 What NOT to break

N2: with `INTEGRATIONS_ENABLED` off (local mode default), the app has zero references to
`apps/runner`/`apps/worker` reachability and no dead "Run integration" controls (localMode test).
N4: nothing reaches the graph outside `applyProposal`/the Applier transaction. N5: no tool code path
exists outside `apps/runner`. Existing capture (P6), sync (P8) and undo (P3/P4) behavior is
untouched — this phase adds a new write path parallel to, not through, the existing board-mutation
surfaces.

## 15 Documentation to update

`10_INTEGRATIONS.md` (mark shipped, note any deviation), `09_BACKEND.md` §4 (token/REST as built),
`15_SECURITY.md` (sandbox baseline as shipped), `docs/adr/ADR-002-feature-flags.md` (`integrations`
row), `docs/backend/BACKEND_STATUS.md` (tool runner row — currently stale, says "roadmap P7"),
tracker.

---

# P10 — GitHub integration

## 1 Objective

Ship the first real, non-`builtin` integration on top of P9's pipeline: GitHub repository nodes,
canonicalization of pasted GitHub URLs, README/releases/contributors/languages/license fetch, and
the deterministic (non-LLM-authoritative) Repository Analysis Agent that produces a structured
`RepositoryAnalysis` and an `ImportProposal` of related entities (contributors as `person` nodes,
linked domains/homepages, related repos). No sandbox container is used — GitHub is HTTP-only
(`11_GITHUB.md` §1 table), so this phase adds **no** new runner container image, only a manifest,
an HTTP adapter and parsers.

## 2 Context (what exists now)

P9 shipped the manifest schema, `apps/runner` (container + `http` + `builtin` executors),
`apps/worker`'s `integration.parse` queue, run history, scoped API tokens, the consent gate and one
proof manifest (`expand-url`). This phase is the first to exercise the `http` executor kind and the
first to exercise a manifest with `consent.required` beyond the trivial `builtin` case. `packages/domain/src/capture`
(P6) already recognizes pasted URLs generically; this phase adds the GitHub-specific pure canonicalizer
that the paste pipeline calls **before** falling back to a generic `link` node
(`06_NODE_SYSTEM.md` §3 fallback kind), so a pasted `github.com/owner/repo` URL becomes a `repository`
node candidate even before any run — the integration only enriches an already-created node.

## 3 Existing architecture to respect

- `11_GITHUB.md` — the primary reference, **all sections**; this phase implements it as written:
  authentication modes (§2: unauthenticated / PAT / GitHub App), URL detection and canonicalization
  (§3), the `Repository` node (§4), the Repository Analysis Agent (§5), the Integration Proposal
  (§6), graph mapping (§7), rate limiting and budget accounting (§8), error copy and quota UX (§9),
  job definitions (§10).
- `10_INTEGRATIONS.md` §1 (R1–R7, especially R2: adding a tool touches only
  `packages/integrations/github/*` + one registry line + an icon + this spec doc) and §4 (manifest
  shape this integration's `manifest.ts` must satisfy).
- `06_NODE_SYSTEM.md` §3 (node type registry, fallback-to-`link` rule for a removed integration).
- `15_SECURITY.md` §6 (SSRF: `raw.githubusercontent.com` and API host allowlisted explicitly, no
  redirect-following to arbitrary hosts), §4 (PAT storage — encrypted at rest, never logged).

## 4 Files/modules affected

```text
packages/integrations/github/
  manifest.ts, adapter.ts                 -- API client, canonicalizer, capability probe (§2.5)
  parsers/{readme.ts,releases.ts,contributors.ts,languages.ts,license.ts,issues.ts}
  analysis/{cloneless.ts,summarize.ts,scoring.ts}    -- Repository Analysis Agent, §5
  mapper.ts                                -- node + relationship mapping, §7
  fixtures/                                -- recorded raw API responses (parser golden tests)
packages/domain/src/url/github.ts          -- pure canonicalizer, called from the paste pipeline (P6)
apps/worker/src/queues/github.ts           -- job queue named in §10, separate from integration.parse
apps/web/src/features/github/
  RepositoryPanel.tsx, ContributorsList.tsx, ReleasesTab.tsx, AnalysisSummary.tsx,
  TokenSettings.tsx                        -- PAT/App connection UI, §2
packages/db/prisma/schema.prisma           -- github_connections (per-user token/App install ref)
```

## 5 Exact requirements (numbered, testable)

1. Three auth modes exactly as §2: unauthenticated (default, budget read from rate-limit headers,
   conservative fallback of 60 req/h/instance if headers are absent), user PAT (encrypted at rest,
   scoped to `repo:read`/`public_repo` only, never logged), GitHub App (org-level, higher budget).
   The active mode is per user per project; an org can pin one via project settings.
2. URL detection/canonicalization exactly as §3: a pure, client-side function
   (`packages/domain/src/url/github.ts`) recognizes repo/issue/PR/user/gist URLs, strips tracking
   params, resolves default-branch-relative paths, and runs inside the P6 paste pipeline with the
   same ≤ 1 ms budget as the other pure selectors it sits beside.
3. `Repository` node exactly as §4: fields, sub-panels (README rendered sanitized markdown,
   releases, contributors first page, languages bar, license badge, topics), refresh action that
   re-runs the manifest for that node.
4. Repository Analysis Agent exactly as §5: clone-less (API + raw file fetch only, no `git clone`
   in `apps/runner`/`apps/worker` — GitHub needs no sandbox per §1's table), deterministic scoring,
   producing a `RepositoryAnalysis` object with the fields §5 defines; LLM enrichment (if configured)
   is additive and marked as such, never authoritative (14_AI_AGENT.md is out of scope, §15 below).
5. Integration Proposal exactly as §6: contributors above a configurable threshold become `person`
   node candidates, homepage/social links become `url`/`domain` candidates, related repos (from
   "used by"/topics overlap) become `repository` candidates — every candidate carries full
   provenance (P9 §3.1) with `tool: 'github'`.
6. Graph mapping and dedupe exactly as §7: identity key is the canonical `owner/repo` (case-folded),
   re-running an analysis updates the existing node rather than creating a duplicate.
7. Rate limiting and budget accounting exactly as §8: the adapter self-throttles to the
   header-reported budget, queues requests past the budget with a visible ETA rather than failing,
   and the unauthenticated-mode shared-IP caveat is surfaced in the UI (§9).
8. Error copy and quota UX exactly as §9 (canonical strings, not generic errors — N-requirement).
9. Job definitions exactly as §10: `apps/worker` queue `github`, separate from P9's generic
   `integration.parse` queue because GitHub jobs are I/O-bound network calls, not CPU-bound parsing.
10. Manifest conforms to P9's schema; `packages/integrations/github` is the only place any
    `github`-specific identifier may appear outside spec docs and UI icons (R1, enforced by P9's
    `no-tool-names-in-core` rule — this phase must not need an exception).
11. Removing `packages/integrations/github` entirely leaves the app compiling with existing
    `repository` nodes degrading to the `link` fallback kind (§1, `06_NODE_SYSTEM.md` §3) — write
    the test that proves this, do not just assert it in prose.

## 6 UX requirements

- Paste a GitHub URL: a `repository` node appears immediately (client-side canonicalization, no
  network wait) in a "not yet analyzed" state; "Analyze" is one click away, not automatic (N4 —
  analysis is a proposal, never automatic enrichment on paste).
- Token settings: connect a PAT or GitHub App, see current budget/remaining/reset time live, a
  "why unauthenticated mode is limited" explainer with a one-click path to connect.
- Repository panel sub-tabs (README, releases, contributors, languages) each have their own
  loading/empty/error state — a slow releases fetch must not block the README tab from rendering.
- Analysis summary shows its deterministic score/fields first; any LLM-derived text is visually
  distinct and labeled "AI summary — verify against the data above".
- Proposal review reuses P9's `ProposalReview.tsx` — no GitHub-specific review UI fork.
- Quota-exceeded state explains what to do (wait until reset, or connect a token) with the exact
  reset time, never a bare 403.

## 7 Technical requirements

- Adapter uses `safeFetch`; only `api.github.com` and `raw.githubusercontent.com` are in the egress
  allowlist for this manifest (P9 §6.4's per-manifest allowlist mechanism, not a global allowlist
  change).
- No `child_process`, no `git clone` — the analysis agent is clone-less by design (§5), matching
  the "Nothing" row in `11_GITHUB.md` §1's execution-split table for `apps/runner`.
- Parsers are pure functions over recorded fixtures (golden tests, P9 §13.2's convention), version-gated
  per P9 §4.6 so a GitHub API shape change is absorbed by editing one parser module (R5).
- PAT/App tokens encrypted at rest (same KMS/encryption story as any other secret in
  `15_SECURITY.md` §4/§7 — reuse it, do not invent a second scheme).

## 8 Edge cases

- Repo renamed/transferred since the node was created: refresh follows GitHub's redirect once,
  updates the canonical identity key, and records the rename in provenance (not a silent duplicate).
- Repo deleted/made private after a node exists: refresh reports `REPO_UNAVAILABLE` with the exact
  reason from the API response, node is marked stale, not deleted.
- Unauthenticated shared budget exhausted mid-analysis: run goes `partial` with the exact fields
  fetched so far, a clear "connect a token to finish this" affordance, not a failed run.
- A gist or non-repo GitHub URL is pasted: canonicalizer recognizes it as a different, documented
  entity kind (§3) rather than forcing it into the `repository` shape.
- Contributor with a deleted/renamed GitHub account: proposal candidate uses the login snapshot at
  fetch time with a note that the account may no longer resolve.
- Rate-limit headers missing entirely (some GitHub Enterprise setups): adapter uses the documented
  conservative fallback (60 req/h/instance) rather than assuming unlimited.

## 9 Security requirements

- SSRF: only the two documented hosts are reachable for this manifest; redirects off those hosts
  are rejected, not followed (`15_SECURITY.md` §6, N7).
- PATs are scoped to read-only (`repo:read`/`public_repo`), encrypted at rest, never included in
  logs, run records or error messages (mirrors P9's secret-redaction rule for `integration_runs.input`).
- Raw file fetches (`raw.githubusercontent.com`) enforce the same size cap and content-type sniffing
  as any other file ingestion path (`15_SECURITY.md` §5).
- Webhook-free in this phase: GitHub App installation does not register a webhook receiver yet (no
  inbound endpoint to secure) — refresh is pull-only, explicitly out of scope (§15 below).

## 10 Performance requirements

- Canonicalization ≤ 1 ms (paste-pipeline budget, shared with P6's other selectors).
- A full repository analysis (README + releases first page + contributors first page + languages)
  completes ≤ 3 s p95 in authenticated mode, ≤ 6 s p95 unauthenticated (budget-limited, reported not
  hard-gated).
- Golden-fixture parser tests run in-process, no network, ≤ 50 ms each.

## 11 Tests to write (named)

- `packages/domain/test/url.github.test.ts` (valid repo/issue/PR/user/gist URLs, hostile inputs,
  tracking-param stripping, default-branch resolution).
- `packages/integrations/github/test/manifest.schema.test.ts` (conforms to P9's manifest schema).
- `packages/integrations/github/test/parsers.golden.test.ts` (≥ 3 fixtures per parser: happy,
  truncated, malformed, per P9's parser golden-test convention).
- `packages/integrations/github/test/analysis.scoring.test.ts` (deterministic score reproducible
  from a fixed fixture, no network, no LLM call).
- `packages/integrations/github/test/mapper.dedupe.test.ts` (re-analysis updates, never duplicates).
- `apps/worker/test/queue.github.test.ts`.
- `e2e/integrations/github-paste-and-analyze.spec.ts`, `e2e/integrations/github-quota-exceeded.spec.ts`.
- `e2e/integrations/github-remove-degrades-to-link.spec.ts` (requirement 11's test).

## 12 Acceptance criteria (checkable)

1. Pasting a GitHub repo URL creates a `repository` node with no network call, in an
   "not yet analyzed" state.
2. Clicking "Analyze" in unauthenticated mode returns README, releases, contributors and languages
   within budget, or a clear `partial` state naming what was skipped and why.
3. Connecting a PAT raises the effective budget and the UI reflects the new limit immediately.
4. Re-running analysis on the same repo updates the existing node; no duplicate `repository` node
   is ever created.
5. Deleting `packages/integrations/github` and rebuilding leaves the app compiling, with existing
   repository nodes rendering via the `link` fallback kind.
6. Every contributor/related-repo/link candidate proposed carries full provenance naming `github`,
   the run id and a confidence bucket.

## 13 Definition of Done

Acceptance criteria pass; `11_GITHUB.md` has no undocumented deviation; parser fixtures are
committed raw tool output (not hand-written); coverage ≥ 85% on `packages/integrations/github`
and the new `packages/domain/src/url/github.ts`; tracker ticked.

## 14 What NOT to break

R1 (no tool-specific code outside `packages/integrations/github`) and R2 (adding this tool touched
only the files R2 promises) — a PR that touches `apps/api`/`apps/web/src/app`/`packages/canvas-engine`
beyond icon registration must justify why in "What was intentionally not touched" per the roadmap's
PR-body convention. P9's manifest schema, runner, worker queue infrastructure and consent gate are
reused unmodified — this phase does not fork or extend the pipeline contracts.

## 15 Documentation to update

`11_GITHUB.md` (mark shipped, note any deviation), `10_INTEGRATIONS.md` (github as the reference
example of a real, non-`builtin` manifest, if the example section references one), `15_SECURITY.md`
(per-manifest egress allowlist as shipped), tracker. Out of scope for this phase's docs: webhook
receiver (no inbound endpoint exists yet — first candidate for a later hardening pass, not
re-litigated here), AI-driven analysis narrative (`14_AI_AGENT.md`, P13).

---

# P11 — Sherlock integration (scope stub)

Full 15-section prompt not yet written; expand this stub when P11's turn comes. Canonical scope
per `00_MASTER.md` §7 and `13_SHERLOCK.md` (already fully specified, ready to implement against):

- Manifest + sandboxed container adapter for Sherlock, on top of P9's `apps/runner` container
  executor (not the `http`/`builtin` path P10 used — Sherlock is untrusted third-party code, N5).
- `username` node → run → `profile` nodes per site, with claimed/available/error semantics and a
  version-gated, defensively-parsed JSON artifact contract (`13_SHERLOCK.md` §3).
- Confidence derivation and dedupe against existing `person`/`profile` nodes (P9's identity-key and
  merge machinery, reused, not forked).
- Re-run diffing that feeds a watchlist (new/changed/disappeared sites since the last run).
- Ethics/consent gating reusing P9's consent gate, with Sherlock-specific scope text.
- Depends on: P9 (runner sandbox, manifest pipeline). Independent of P10.

---

# P12 — SpiderFoot integration (scope stub)

Full 15-section prompt not yet written; expand this stub when P12's turn comes. Canonical scope
per `00_MASTER.md` §7 and `12_SPIDERFOOT.md` (already fully specified):

- `SpiderFootClient` adapter with a mandatory capability probe, supporting both a user-provided
  instance and a Raven-managed container (two deployment models, `12_SPIDERFOOT.md` §2).
- Scan configuration UX with a legal consent gate (reuses P9's consent gate, adds a scan-specific
  scope/target confirmation step).
- Event-type → Raven entity mapping with confidence and dedupe rules on top of P9's resolver.
- Volume control so a scan emitting tens of thousands of events never floods the canvas (batched
  proposals, capped per-review-page counts — new UI, not a P9 change).
- The weekly canary run against a known fixture target (Open risk 1 in `10_INTEGRATIONS.md`,
  explicitly deferred to this phase) to catch silent semantic drift in either tool.
- Depends on: P9. Independent of P10/P11.

---

# P13 — AI layer (scope stub)

Full 15-section prompt not yet written; expand this stub when P13's turn comes. Canonical scope per
`00_MASTER.md` §7 and `14_AI_AGENT.md` (already fully specified — see its own Scope section for the
exact dependency list: P3, P4, P7, P9):

- Provider abstraction (`AIProvider` interface), model routing, cost accounting and the user-facing
  AI activity log.
- `AIProposal` write model — reuses P9's Proposal/Apply layer verbatim (`14_AI_AGENT.md` Scope:
  "Out of scope: integration execution", i.e. this phase does not touch `apps/runner`).
- The twelve shipped capabilities (summarize, explain, suggest links, dedupe, cluster, investigation
  summary, etc.) each as trigger → context → prompt → schema → validation → UX.
- Retrieval: embeddings, chunking, pgvector (already reserved in `00_MASTER.md` §2's database row),
  hybrid search on top of P7's FTS.
- Guardrails: prompt-injection, hallucination, PII handling, retention limits.
- Depends on: P3, P4, P7, P9. Ships no execution sandbox of its own — it is a proposer, like every
  integration, never a direct writer (N4).

---

# P14 — Views (scope stub)

Full 15-section prompt not yet written; expand this stub when P14's turn comes. Canonical scope per
`00_MASTER.md` §7 and `03_UX.md` §16 (view modes already specified) and the `?view=` route param
already reserved in `03_UX.md` §2:

- Graph (force-directed), timeline (chronology by `observed_at`, already speced in `03_UX.md` §16),
  table, list and map view modes as canvas-area replacements, sharing the same underlying node/edge
  selection and the existing keyboard map (`Ctrl+Alt+1..6`, already reserved in `03_UX.md` §15).
- Auto-layout suite (the structure-is-earned-not-demanded principle, `00_MASTER.md` §3.3): a
  reversible, previewable layout pass per view, never applied without an explicit accept (same
  Proposal discipline, though this is a layout diff, not new nodes).
- View state (which view, per board) is UI state, not document state (N2's "Zustand for ephemeral
  UI state only" rule) — must not enter the CRDT.
- Depends on: P2 (canvas engine), P4/P5 (nodes/edges) — no dependency on P9-P13.

---

# P15 — Groups, presentation & export (scope stub)

Full 15-section prompt not yet written; expand this stub when P15's turn comes. Canonical scope per
`00_MASTER.md` §7; the groups/tags projection surface is already reserved (P8's status note: the
richer `08_DATA_MODEL.md` §5 projection — `groups`/`node_tags`/`entity_resolutions`/`history_events`
— was explicitly deferred here, not implemented in P8):

- Node/edge groups (visual + semantic clustering) with their own Postgres projection tables, filling
  the gap P8 deliberately left open.
- Presentation mode: a scripted, ordered walkthrough of board regions for handing off an
  investigation, reusing P7's boards/templates machinery.
- Report export (formats extend P7's board-export baseline; §12 acceptance criterion 3 of P7 already
  requires templates to "create working boards" that this phase's export must round-trip, N9).
- Archives: cold-storage export of a full project (boards + files + run history) for offline retention.
- Depends on: P7 (boards/templates), P8 (projection pattern to extend), P4/P5 (node/edge model).

---

# P16 — Hardening (scope stub)

Full 15-section prompt not yet written; expand this stub when P16's turn comes. Canonical scope per
`00_MASTER.md` §7 — the closing phase, gated by `00_MASTER.md` §8's quality gate applied
retroactively across everything shipped P1–P15:

- Performance pass: re-run every phase's `bench`/k6 numbers together at realistic combined load
  (N1's 5,000/10,000 budget under sync + integrations + AI concurrently, not each in isolation).
- Security audit: closes the Open risks recorded across `10_INTEGRATIONS.md`, `12_SPIDERFOOT.md`,
  `15_SECURITY.md` (e.g. the fuzzy-dedupe-threshold-as-org-setting item, the run `coverage` field
  for partial Sherlock/SpiderFoot runs — both explicitly flagged as P16 follow-ups in
  `10_INTEGRATIONS.md`'s Open risks 5 and 6).
- Accessibility audit: axe-core + manual checklist across every surface shipped since P1 (N6).
- Observability: the `raven_sync_*`/`raven_runner_*`/`raven_worker_*` metrics families unified into
  one dashboard set; alerting reviewed end-to-end, not per-phase.
- GA readiness checklist and sign-off against every N1–N10 non-negotiable, evidenced, not asserted.
- Depends on: everything (P1–P15). This is intentionally the only phase allowed to touch code across
  every package without being "two phases at once" (`00_MASTER.md` §10.2) — it is explicitly the
  cross-cutting closing phase.

---

# P17 — Unified query & orchestration layer

**Status: NOT STARTED.** Depends on P9 (integration framework: manifests, runner sandbox, run
history). Independent of, but designed to consume, the L4 transform/provider registry
(`21_TRANSFORM_SYSTEM.md`, `packages/transforms`, delivered from
`prompts/PROMPT_4_MALTEGO_ECOSYSTEM_RU.md`; see `24_UNIFIED_QUERY.md` §12). Ships no new engines of
its own — it is the layer that decides which engines run, with what budget, and how their output
becomes one coherent graph.

## 1 Objective

Turn one analyst question into one answer: type/paste anything into a single query bar, have Raven
decide which registered capabilities can help, plan them into stages under an explicit budget, run
them concurrently with streaming partial results, normalize every engine's output into the canonical
domain model, deduplicate and resolve entities, derive links, attach provenance and legal posture to
everything produced, and present it in one review surface the analyst accepts onto the board.

## 2 Context (what exists now)

P9 gives manifest-declared integrations, a runner sandbox and run history, but each integration is
invoked individually by the user and returns its own shape into its own proposal panel. There is no
entity typing of free input, no router, no plan, no budget, no cross-engine dedupe, no confidence,
no provenance vocabulary, and no query object. `22_ECOSYSTEM_AUDIT.md` fixes which engines are
allowed to exist behind the router; `24_UNIFIED_QUERY.md` is the design this phase implements.

## 3 Existing architecture to respect

- `24_UNIFIED_QUERY.md` — primary reference, all sections.
- `22_ECOSYSTEM_AUDIT.md` §7 (BYOK rules) and §8 (what we build ourselves).
- `10_INTEGRATIONS.md` (manifest schema, runner sandbox, proposal/accept flow — reuse, do not fork).
- `08_DATA_MODEL.md` (entity/relation model, CRDT-safe merge/un-merge), `07_EDGE_SYSTEM.md`
  (derived-edge rendering), `03_UX.md` (command palette, review surfaces),
  `15_SECURITY.md` (`safeFetch`, SSRF, sandbox, credential storage), `16_PERFORMANCE.md` (budgets).
- `docs/adr/ADR-001-local-first.md` — the router's mode gate is the enforcement point of that ADR.

## 4 Files/modules affected

```text
packages/domain/src/query/{capability.ts,selectors.ts,plan.ts,provenance.ts,confidence.ts,identity.ts}
packages/query-engine/src/{router.ts,planner.ts,executor.ts,budget.ts,cache.ts,events.ts}
packages/query-engine/src/normalize/{mapper.ts,registry.ts}
packages/query-engine/src/resolve/{blocking.ts,score.ts,merge.ts}
packages/query-engine/src/derive/{cooccurrence.ts,rules.ts}
packages/query-engine/src/adapters/{integration-registry.ts,transform-registry.ts}
apps/web/src/features/query/{QueryBar.tsx,PlanReview.tsx,ResultStream.tsx,ReviewQueue.tsx,RunReport.tsx}
apps/web/src/data/workspace/query.ts            (local + server repository methods)
apps/api/src/routes/query/{plan.ts,run.ts}      (server mode only)
bench/query/{router.bench.ts,dedupe.bench.ts}
```

## 5 Exact requirements (numbered, testable)

1. `CapabilityDescriptor` exactly as in `24_UNIFIED_QUERY.md` §2, validated by zod at registration;
   an invalid descriptor fails registration loudly and the engine stays unavailable.
2. Descriptors are derived from integration manifests by one adapter, and projected from
   `@nexus/transforms` manifests by a second adapter; no descriptor is hand-written twice, and both
   projections are contract-tested against their source.
3. Selectors for domain (IDN/punycode), URL, IPv4/IPv6/CIDR, e-mail, E.164 phone, username handle,
   hash, BTC/ETH address, LEI, company name, free text — pure, offline, ≤ 1 ms, fully unit-tested
   including hostile inputs.
4. Ambiguous input returns ranked candidates; the UI disambiguates once per session per string.
5. The router applies the eight filter stages in `24` §4 in that order and records a machine-readable
   reason for every dropped capability.
6. The router is a pure function: given the same registry, mode, credentials, budget and policy it
   returns the same plan. No I/O, no clock reads outside an injected clock.
7. Plans are staged; stage 0 contains only offline/cache steps and always exists.
8. Budgets (`wallMs`, `requests`, `credits`, `maxNodes`, `maxDepth`) are enforced by the executor,
   not by adapters; exceeding any of them ends the run as `partial`, never as an error.
9. Any paid step, any `active-probe` step, or any posture riskier than `public-api` requires explicit
   approval before the run starts; the threshold is a workspace setting.
10. Execution is concurrent per stage under a global semaphore and per-engine rate limits, with
    timeout, bounded retry (idempotent failures only), circuit breaker, and cooperative cancellation
    that also kills child processes.
11. `QueryEvent`s stream to the UI; the first stage-0 result renders before any network step finishes.
12. Every produced entity/relation carries provenance: capability id, engine + version, run id, input,
    timestamp, cache hit or live, legal posture, licence ref, confidence.
13. Normalization mappers are pure, versioned and tested against recorded fixtures of real engine
    output; canonicalization lives in `packages/domain`, not in mappers.
14. Deduplication: exact `identityKey` auto-merges; probabilistic scoring with the thresholds in
    `24` §7.3; merges are events with a full audit trail and exact un-merge.
15. Confidence combines declared precision, corroboration (noisy-OR, `upstream`-aware) and age decay.
16. Derived links are typed, carry `derivedBy` + evidence, render distinctly and are individually
    rejectable.
17. Run modes Local-only / Zero-credential / Free-tier / Full behave exactly as `24` §8; local mode
    defaults to Zero-credential and the active mode is always visible on the query bar.
18. In Local-only, a capability declaring `offline: true` that opens a socket is blocked by the
    sandbox and the run is marked `contract-violation`; a test proves the block.
19. Results are proposals: nothing enters the board graph without an explicit accept (N-rule from
    `17_PLUGIN_SDK.md` P1).
20. A run is persisted as a `QueryRun`; a saved query is a canvas node; re-running produces a diff
    (new / changed / disappeared), never duplicate subgraphs.
21. Cache keys include descriptor and engine versions; cached results are labelled as cached.
22. `packages/query-engine` imports only `packages/domain` and `@nexus/transforms`; the reverse
    direction is forbidden and dependency-cruiser enforces both.

## 6 UX requirements

- One query bar, reachable from `Ctrl+K` and from an empty canvas; it accepts anything.
- The plan is shown before an approved run: stages, engines, estimated time, estimated cost, and a
  collapsed "N capabilities hidden — why" list with one-click remedies (connect a key, allow network,
  raise the budget).
- Results stream into a side surface grouped by entity type, with accept / accept-all / reject and a
  duplicate-review queue; the canvas only changes on accept.
- Empty, loading, partial, degraded, error and cancelled states are all designed — "partial" and
  "degraded" are first-class, not an error toast.
- Cost and quota burn are visible during the run; crossing a threshold pauses and asks.
- Every node's inspector shows its provenance chain in one click, including posture and confidence.
- Keyboard-complete: plan approval, accept/reject, and review-queue navigation need no mouse.

## 7 Technical requirements

- The planner and router run on the main thread (they are microsecond-scale); normalization,
  dedupe scoring and derivation run in a worker.
- Streaming uses the existing event transport; in local mode it never leaves the device.
- All outbound HTTP goes through `safeFetch`; child processes run in the P9 runner sandbox.
- Deterministic replay: plan + seed + recorded responses reproduce the graph byte-for-byte.
- No `any` at boundaries; zod at every ingress including adapter output.

## 8 Edge cases

- Zero capabilities match (offline, no keys) → an honest empty state naming what would unlock it.
- One engine returns 50,000 entities → truncation by score at `maxNodes`, visibly reported.
- Two engines disagree on the same fact → both retained, conflict flagged, no silent winner.
- An engine returns valid JSON with a subtly wrong shape → mapper rejects, engine quarantined.
- A capability declares `offline` but needs a model download on first use → treated as network.
- Re-run after an engine's descriptor version changed → cache invalidated, diff explains why.
- Cancellation mid-merge → the merge is atomic; either it happened and is auditable, or it did not.
- The transform registry is absent → no `transform` capabilities exist and everything else works.

## 9 Security requirements

- Credentials never appear in plans, events, run history, exports, logs or error messages.
- `active-probe` requires a recorded per-target authorization acknowledgement.
- `licensed-data` output is flagged `redistribution: restricted` and excluded from exports without
  an explicit override.
- LLM-driven browsing capabilities run only inside the egress-allow-listed sandbox; page content is
  untrusted input and can never become instructions.
- Adapter output size caps and parse timeouts prevent a hostile engine response from wedging the app.

## 10 Performance requirements

All numbers from `24_UNIFIED_QUERY.md` §13, benchmarked in `bench/query/`: intake ≤ 1 ms, plan for a
40-capability registry ≤ 15 ms, first result ≤ 200 ms p95, orchestration overhead ≤ 2 % of a network
run, normalize + dedupe of 1,000 entities ≤ 400 ms, no dropped frame > 16 ms while streaming 1,000
entities, ≤ 150 MB worker memory for a 10,000-entity run.

## 11 Tests to write (named)

- `packages/domain/test/query.selectors.test.ts` (valid, hostile and ambiguous inputs).
- `packages/query-engine/test/router.purity.test.ts`, `router.filters.test.ts` (one case per stage,
  asserting the drop reason).
- `packages/query-engine/test/planner.stages.test.ts`, `planner.budget.test.ts`.
- `packages/query-engine/test/executor.failures.test.ts` (timeout, 429, auth, contract violation,
  circuit breaker, cancellation).
- `packages/query-engine/test/normalize.fixtures.test.ts` (recorded output of ≥ 5 real engines).
- `packages/query-engine/test/resolve.merge.property.test.ts` (merge→un-merge is identity).
- `packages/query-engine/test/confidence.corroboration.test.ts` (shared `upstream` does not boost).
- `packages/query-engine/test/mode.local-only.test.ts` (socket attempt is blocked and reported).
- `e2e/query/one-query-many-engines.spec.ts`, `e2e/query/partial-failure.spec.ts`,
  `e2e/query/rerun-diff.spec.ts`, `e2e/query/paid-approval.spec.ts`.
- `bench/query/router.bench.ts`, `bench/query/dedupe.bench.ts`.

## 12 Acceptance criteria (checkable)

1. Pasting a domain with no keys and no network still produces results from stage 0 within 200 ms.
2. A single query fans out to ≥ 3 engines concurrently and renders results as they arrive.
3. Killing one engine mid-run yields a `degraded` result containing every other engine's output.
4. The same entity found by three engines appears once, with three provenance records and a higher
   confidence than any single source.
5. Two engines sharing an upstream do not raise confidence above a single source's.
6. A paid capability never runs without explicit approval, and the spend reported after the run
   matches the estimate's unit accounting.
7. In Local-only mode, no socket is opened during a full run (asserted at the sandbox level).
8. Re-running a saved query after a change produces a diff, not duplicates.
9. Every node on the board can name the run, engine, input, time, posture and confidence that made it.
10. `pnpm check:gates` and dependency-cruiser pass with `packages/query-engine` depending only on
    `packages/domain`.

## 13 Definition of Done

Acceptance criteria pass; coverage ≥ 85 % lines on `packages/query-engine` and `packages/domain`
query modules; benchmarks recorded in `16_PERFORMANCE.md`; `24_UNIFIED_QUERY.md` updated with the
numbers actually measured and the §15 open questions resolved; both trackers ticked.

## 14 What NOT to break

The local-first guarantee (N2) — the query bar must work fully with no network, no account and no
keys. The propose-never-write rule — no engine output may mutate the board without an accept. Undo
semantics — accepting a batch of results is one undoable operation. Existing per-integration flows
from P9 keep working; this layer sits above them and does not fork the manifest or the runner.

## 15 Documentation to update

`24_UNIFIED_QUERY.md` (measured numbers, resolved open questions), `22_ECOSYSTEM_AUDIT.md` (any
engine added or re-tiered), `10_INTEGRATIONS.md` (the descriptor-derivation contract),
`03_UX.md` (query bar, plan review, review queue), `15_SECURITY.md` (posture vocabulary as shipped),
`08_DATA_MODEL.md` (`QueryRun`, merge audit), `16_PERFORMANCE.md`, both trackers.

---

# L4 — Transform layer (Maltego-inspired ecosystem)

Source requirement: `prompts/PROMPT_4_MALTEGO_ECOSYSTEM_RU.md`. Design:
`RAVEN-SPEC/21_TRANSFORM_SYSTEM.md`. Research: `docs/ecosystem/`.

This layer is numbered separately from P1–P16 because it runs **in parallel** with them: L4.1–L4.3
need no runtime and no UI, while L4.4 onward depend on the integration runtime (P9) and the canvas
UI. Nothing here changes a phase that is already done.

| Phase    | Content                                                                                                                                                                                           | Depends on          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **L4.1** | Ecosystem audit, provider catalogue, transform catalogue, this spec, `packages/transforms` foundation: manifests, registries, capability router, modes, scoring, expand planner, seeded catalogue | —                   |
| **L4.2** | Transform SDK surface for third parties and the conformance test harness — **shipped** (PR #20), see the ledger                                                                                   | L4.1, 17_PLUGIN_SDK |
| ~~L4.3~~ | Run history, replay, run comparison and the result cache with TTL and age labelling — **shipped** (PR #21), see the ledger                                                                        | L4.1, P3            |
| L4.4     | Execution integration: engines become Runner jobs, streaming partial results, cancellation, budgets enforced at run time                                                                          | P9                  |
| L4.5     | Canvas UX: contextual menu, hover chips, Expand with preview, result clusters, density control, data-flow disclosure                                                                              | L4.4, P4/P5         |
| L4.6     | Provider vault, provider settings UI, ecosystem health check (stale `lastVerified`, dead endpoints, deprecations)                                                                                 | L4.4, P9            |
| L4.7     | Agent-driven transform planning under budgets, plan explanation, smart chaining                                                                                                                   | L4.4, 14_AI_AGENT   |

**L4.2 shipped** (PR #20): the engine contract, host driver, testkit and 14-check conformance
harness live in `packages/transforms/src/sdk`; `21_TRANSFORM_SYSTEM.md` §12a is the binding spec.

**L4.1 shipped** (PR #15): see the ledger. Acceptance criteria for it are now permanent invariants
of `packages/transforms`, asserted by `test/catalog.contract.test.ts` — registry validation clean,
every `core` transform reachable with zero credentials, no network engine in strict-local mode,
every fallback chain terminal, no future `lastVerified`, every plan states its exclusions, and code
cannot drift from `docs/ecosystem/*.md`.

## What NOT to break

The transform layer must not become a second integration framework: execution, parsing, entity
extraction and the `ImportProposal` write path stay in `10_INTEGRATIONS.md`. Transforms must never
name providers directly (rule T1), and no result may reach the graph without a proposal (N4).
