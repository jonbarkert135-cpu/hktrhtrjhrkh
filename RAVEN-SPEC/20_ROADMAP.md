# Raven — 20 — IMPLEMENTATION ROADMAP (phase prompts P1…P16)

## Scope

This file is the executable plan. It contains one self-contained implementation prompt per phase
from `00_MASTER.md` §7, each with the same 15 sections, written so a fresh coding AI with no memory
of previous sessions can execute it by reading only this prompt plus the spec sections it names.
It also defines how to use the prompts, the branch/PR convention, the quality-gate reminder, a
progress tracker and the phase dependency graph.
Nothing here may contradict `00_MASTER.md`; if it does, `00_MASTER.md` wins.

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

# P1 — Foundation

**Status: DONE** — implemented in `phase/p01-foundation` (PR #2). Local gates green: typecheck, lint,
test + coverage floors, build (144.1 KB gzip initial JS), check:gates, depcruise. Docker-compose, e2e,
visual and bench thresholds are verified in CI only (no Docker in the authoring environment).

## 1 Objective

Stand up the monorepo, the design-token pipeline, the authenticated app shell, the database, the CI
pipeline and the benchmark harness, so that every later phase has a working, gated, testable
skeleton to build inside. At the end of P1 a user can sign up, sign in, see an empty application
shell with a placeholder board surface, and CI enforces the full quality gate on every PR.

## 2 Context (what exists now)

Only `RAVEN-SPEC/` exists. There is no code, no package manager workspace, no database, no CI.
Everything in this phase is greenfield; there is nothing to preserve except the specification.

## 3 Existing architecture to respect

- `00_MASTER.md` §2 (frozen stack — TypeScript 5.6 strict, React 19 + Vite 6, Fastify 5 + tRPC v11,
  Postgres 16 + Prisma, Better-Auth, Tailwind v4 preset generated from CSS custom properties),
  §5 (layer boundaries), §6 (monorepo layout — reproduce it exactly).
- `02_ARCHITECTURE.md` §1–3 for layer contracts and runtime topology.
- `04_DESIGN_SYSTEM.md` for the token architecture; tokens are the single source of design values.
- `19_DEPLOYMENT.md` §1.1 (env schema), §5 (CI workflow), §6 (dependency-cruiser rules).
- `18_TESTING.md` §2–3 (test layout, Vitest config), §9 (bench harness), §15 (seeding).

## 4 Files/modules affected

```text
package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, .npmrc, .nvmrc
packages/config/{eslint,tsconfig,vitest,tailwind,src/env.ts,src/flags.ts}
packages/ui/src/{tokens/*.css,tokens/tokens.ts,primitives/*,index.ts}
packages/db/{prisma/schema.prisma,prisma/migrations/*,src/client.ts,seed/dev.ts}
packages/domain/src/{index.ts,clock.ts,ids.ts}
apps/web/{index.html,vite.config.ts,src/main.tsx,src/app/{router.tsx,shell/*},src/lib/trpc.ts}
apps/api/src/{server.ts,trpc/{context.ts,router.ts,routers/auth.ts},auth/*,plugins/*,healthcheck.ts}
bench/{harness.ts,canvas.bench.ts,compare.mjs}
e2e/{playwright.config.ts,global.setup.ts,journeys/J01-signup.spec.ts}
infra/{docker-compose.yml,docker/*.Dockerfile,egress/envoy.yaml}
.github/workflows/ci.yml, .github/actions/bootstrap/action.yml
scripts/{check-no-todo.mjs,check-skips.mjs,check-coverage.mjs,diff-coverage.mjs,check-bundle-secrets.mjs,check-migration-safety.mjs}
.dependency-cruiser.cjs, .eslintrc.cjs (or eslint.config.js), commitlint.config.cjs
```

## 5 Exact requirements (numbered, testable)

1. pnpm workspace with Turborepo; `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck` work from
   the root and are cached per package.
2. TypeScript 5.6 `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`,
   `verbatimModuleSyntax: true`; zero `any` in `packages/domain` (ESLint `no-explicit-any` error).
3. `packages/ui` exposes design tokens as CSS custom properties in `tokens/*.css` plus a typed
   `tokens.ts` mirror; the Tailwind v4 preset is **generated** from `tokens.ts` by a build script,
   so a token exists in exactly one place.
4. ESLint rule `no-hardcoded-design-values` fails on hex colors, raw px in styles (except 0, 1px
   borders) and raw ms durations outside token files.
5. Postgres 16 + Prisma with the initial schema: `organizations`, `users`, `memberships` (role enum
   `owner|admin|editor|viewer`), `sessions`, `accounts`, `projects`, `boards`, `audit_log`.
   Every table has `id` (cuid2), `created_at`, `updated_at`.
6. Better-Auth wired with email+password and one OAuth provider (GitHub), sessions in Postgres,
   30-day rolling session, secure cookies (`httpOnly`, `sameSite=lax`, `secure` outside local).
7. Fastify 5 + tRPC v11 with a typed `Context` carrying `{ user, org, role, req_id, logger }`;
   procedures `publicProcedure`, `protectedProcedure`, `orgProcedure(minRole)`.
8. `/healthz` (process alive) and `/readyz` (DB + Redis reachable) endpoints; `/metrics` on 9464
   with at least `raven_http_requests_total` and `raven_http_request_duration_seconds`.
9. React 19 + Vite 6 SPA with routes `/`, `/login`, `/signup`, `/p/:projectId`, `/b/:boardId`,
   `/settings`; unauthenticated access to app routes redirects to `/login?next=…`.
10. App shell: top bar (org switcher, board title, sync status placeholder, user menu), left rail
    (projects), right panel slot (inspector placeholder), center surface hosting a placeholder
    canvas element with the grid drawn by a minimal Canvas2D renderer (the real engine is P2).
11. `packages/config/src/env.ts` zod env schema exactly as in `19_DEPLOYMENT.md` §1.1; the API and
    every service refuse to boot on invalid config with a readable multi-line error.
12. Structured logging (pino) with the mandatory fields from `19_DEPLOYMENT.md` §10.3 and the
    redaction list; a unit test proves secrets are redacted.
13. CI workflow implementing every job in `19_DEPLOYMENT.md` §5, with `ci-ok` as the single
    required check. All jobs must be green on the P1 PR itself.
14. `bench/harness.ts` + `bench/canvas.bench.ts` running against the placeholder surface, producing
    the JSON metric shape defined in `18_TESTING.md` §9.1 and comparing against a baseline
    (the P1 baseline is "record only"; the gate becomes enforcing in P2).
15. `infra/docker-compose.yml` from `19_DEPLOYMENT.md` §3 brings the whole stack up on a clean host;
    `pnpm db:seed` populates the dev data set from `18_TESTING.md` §15.
16. `packages/db` migrations pass `scripts/check-migration-safety.mjs`.

## 6 UX requirements

- Dark theme only (light theme is a later, token-only change). Background, surface, border and text
  tokens per `04_DESIGN_SYSTEM.md`; contrast ≥ 4.5:1 text, ≥ 3:1 UI (N6).
- Auth screens: single-column, 400 px content width, states — idle, submitting (button spinner,
  inputs disabled), field error (inline, under the field, red border + message), form error
  (banner above the form with cause and next step, no generic "Something went wrong"), success
  (redirect with no flash of unauthenticated shell).
- Empty states everywhere: no projects → "Create your first project" with a primary action and a
  one-sentence explanation; no boards → same pattern.
- Loading: shell renders instantly with skeletons; never a blank white page. Skeletons use the
  token surface colors, no shimmer animation under `prefers-reduced-motion`.
- Focus: visible 2 px focus ring using `--ring` on every interactive element; tab order follows
  visual order; `Skip to content` link as the first focusable element.
- Keyboard: `⌘/Ctrl+K` opens a palette stub (registers the shortcut and shows "No commands yet" —
  the real palette is P7). This reserves the shortcut and proves the shortcut system works.

## 7 Technical requirements

- Vite build target `es2022`, code-splitting per route, initial JS ≤ 250 KB gzip (enforced by
  `scripts/check-bundle-budget.mjs`).
- tRPC client with a single `TRPCProvider`, `superjson` transformer, and error mapping that turns
  `TRPCError` codes into user-facing copy (`03_UX.md` §12).
- Prisma client is a singleton in `packages/db/src/client.ts` with connection pooling from env.
- All server input validated by zod at the procedure boundary — no unvalidated `req.body` anywhere.
- Dependency-cruiser rules from `19_DEPLOYMENT.md` §6 active and green.
- Node 22 LTS pinned by `.nvmrc` and by the Docker base images.
- Commit hooks: lint-staged (eslint + prettier) and commitlint.

## 8 Edge cases

- Signup with an email that already exists → generic "If that address can be used, we sent a link"
  style response for enumeration resistance, but a clear inline message on login failure.
- OAuth callback with a mismatched state or an expired code → error screen with a retry action.
- Session expires while the SPA is open → the next tRPC call returns `UNAUTHORIZED`, the client
  shows a re-login modal without losing the current route.
- Two browser tabs, sign out in one → the other detects the invalidated session on its next call
  and shows the same modal.
- DB unreachable at boot → the service logs a fatal, exits non-zero; Kubernetes/compose restarts it;
  `/readyz` never reports ready while the DB is down.
- Clock skew between client and server does not affect session validity checks (server time only).

## 9 Security requirements

- Password hashing by Better-Auth's default (argon2id or bcrypt with cost ≥ 12); never custom.
- Rate limits: 10 login attempts / 5 min / IP+email, 5 signups / hour / IP, 100 API req/min/user;
  429 responses include `Retry-After`.
- CSRF protection on cookie-authenticated non-idempotent routes (origin check + `sameSite=lax`).
- Security headers as in `19_DEPLOYMENT.md` §3 Caddyfile, including a CSP with no `unsafe-eval`.
- `audit_log` entries for: signup, login, failed login, logout, org create, project create/delete,
  role change. Append-only; no update path exists in code.
- No secret ever reaches the client bundle (`scripts/check-bundle-secrets.mjs` in CI).

## 10 Performance requirements

- Cold SPA load on a 2020-class laptop over a simulated Fast 3G: first contentful paint ≤ 1.5 s,
  interactive shell ≤ 2.5 s.
- API p95 for `auth.session` ≤ 60 ms warm, `project.list` ≤ 120 ms with 100 projects.
- The placeholder canvas draws the grid at 60 fps while panning (proves the rAF loop and the bench
  harness are wired correctly).

## 11 Tests to write (named)

- `packages/config/test/env.test.ts` — valid/invalid matrices, production guard for test endpoints.
- `packages/config/test/redact.test.ts` — secret redaction corpus.
- `packages/ui/test/contrast.test.ts` — token contrast (N6).
- `packages/ui/test/no-hardcoded-values.rule.test.ts` — the ESLint rule itself.
- `apps/api/test/auth.session.test.ts`, `apps/api/test/authz.matrix.test.ts` (seeded with the P1
  procedures; the matrix meta-test that enumerates procedures must already exist).
- `apps/api/test/arch.no-child-process.test.ts` (N5, guards the future).
- `apps/api/test/test-endpoints-guard.test.ts`.
- `apps/web/src/app/shell/Shell.test.tsx` — renders skeleton, empty state, error state.
- `e2e/journeys/J01-signup.spec.ts` — signup → project → board → empty canvas.
- `e2e/a11y/axe-sweep.spec.ts` — login, signup, shell (zero violations).
- `bench/canvas.bench.ts` — records the metric JSON shape; `bench/compare.mjs` self-test.

## 12 Acceptance criteria (checkable)

1. `git clone && pnpm i && docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev`
   yields a working app in ≤ 15 minutes on a clean machine, per the README.
2. A new user can sign up, create a project and a board, and reload without losing session.
3. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass locally and in CI.
4. `ci-ok` is green on the P1 PR with every job present (lint, typecheck, unit, coverage-gate,
   build, e2e, visual, bench, audit, docker, migrate-check).
5. axe reports zero violations on `/login`, `/signup`, and the shell.
6. `pnpm bench` writes `bench-results.json` with all nine metric keys (values may be placeholders
   for engine-specific ones, explicitly marked `null`, not fabricated).
7. Changing a color token changes the UI everywhere with no component edits (demonstrated in the PR
   with a before/after screenshot).
8. Booting the API with a missing `AUTH_SECRET` prints a readable error and exits code 1.

## 13 Definition of Done

All acceptance criteria pass; the seven quality-gate checks are evidenced in the PR; README
documents local setup and the compose path; `packages/*/README.md` exist for `config`, `ui`, `db`,
`domain`; the progress tracker in this file is ticked for P1; no `TODO` in shipped code.

## 14 What NOT to break

Nothing exists yet, but do not foreclose the future: do not add React to `packages/canvas-engine`
(it must not exist as a React dependency), do not put business logic in `apps/web`, do not add a
second styling system, do not introduce a global state library other than Zustand, and do not add
any dependency that duplicates a frozen stack choice (`00_MASTER.md` §2).

## 15 Documentation to update

`README.md` (setup, scripts, architecture overview), `packages/config/README.md`,
`packages/ui/README.md` (token usage rules), `packages/db/README.md` (migration workflow),
`19_DEPLOYMENT.md` if the CI job list changes, and the tracker in this file.

---

# P2 — Canvas engine

**Status: DONE** — implemented in `phase/p02-canvas` (PR #3). `packages/canvas-engine` ships camera,
grid spatial index, culling, hybrid renderer (canvas + DOM overlay + LOD), interaction FSM,
selection, snapping, minimap, scheduler and the headless testing harness; `apps/web` hosts it in
`src/app/canvas/` and the P1 placeholder surface is deleted. Local gates green: typecheck, lint,
294 engine tests + 39 web tests, coverage 96.8 % lines / 95.3 % branches on the engine, build
(144.1 KB gzip initial JS), check:gates, depcruise. Headless bench (`BENCH_SKIP_BROWSER=1 pnpm bench`)
records pan-zoom-5000 p95 **1.7 ms**, p99 2.6 ms, first-interactive 5.5 ms, select-all-5000 6.4 ms,
drag-200-selected p95 2.1 ms — measured in Node without GPU or DOM; the browser numbers, memory and
the visual/e2e suites still need CI, which is not running yet (see the repo README open task).
Deviations from §4 are documented in `packages/canvas-engine/README.md`.

## 1 Objective

Implement `packages/canvas-engine`: camera, spatial index, hybrid renderer (Canvas2D for edges,
grid, LOD nodes and marquee; DOM overlay for visible near-zoom nodes), the interaction finite state
machine, selection, dragging, snapping, grid and minimap — meeting N1 (5,000 nodes / 10,000 edges,
p95 frame ≤ 16.6 ms) with the benchmark gate switched to enforcing.

## 2 Context (what exists now)

P1 delivered the monorepo, tokens, app shell, auth, DB, CI and the bench harness, plus a
placeholder canvas that only draws a grid. There is no scene graph, no node model beyond a
placeholder, no persistence (that is P3). Nodes in this phase are plain in-memory objects supplied
by `makeBoard()` from `packages/domain/test/factories.ts`.

## 3 Existing architecture to respect

- `05_CANVAS_ENGINE.md` — the whole document: §2 hybrid rationale, §3 camera math, §4 render loop,
  §5 spatial index, §6 LOD thresholds, §7 interaction FSM, §8 performance budget.
- `00_MASTER.md` §2 (canvas engine must not import React), §4 N1/N6/N8, §5 layer rules.
- `16_PERFORMANCE.md` for budgets and measurement technique.
- `18_TESTING.md` §5 (headless engine testing: recording renderer, manual scheduler, pointer
  scripts, scene snapshots) — the engine's public API must be designed for these tests.
- `04_DESIGN_SYSTEM.md` for every color, radius and stroke width used in canvas painting: the
  engine receives a resolved theme object, it never reads CSS variables at draw time.

## 4 Files/modules affected

```text
packages/canvas-engine/src/
  index.ts                     public API: createEngine(options)
  camera.ts                    viewport <-> world transforms, zoom limits, animations
  scene.ts                     Scene, SceneNode, SceneEdge (engine-level, not domain entities)
  spatial/rbush-index.ts       insert/update/remove/query/queryPoint
  render/renderer.ts           frame orchestration
  render/canvas-layer.ts       grid, edges, LOD nodes, marquee, selection outlines
  render/dom-overlay.ts        mount/unmount/position of visible near-zoom node hosts
  render/target.ts             RenderTarget interface (test seam, 18_TESTING §5.1)
  interaction/fsm.ts           states + transitions
  interaction/gestures.ts      wheel/pinch/pointer normalization
  interaction/snapping.ts      grid snap + alignment guides
  selection.ts, minimap.ts, scheduler.ts, theme.ts, types.ts
apps/web/src/canvas/{CanvasHost.tsx,NodeHost.tsx,useCanvasEngine.ts}
bench/canvas.bench.ts (real metrics now), bench/scenes.ts
packages/canvas-engine/test/**
```

## 5 Exact requirements (numbered, testable)

1. `createEngine({ target, scheduler, theme, initialScene })` returns an object with
   `setViewport`, `applyScenePatch`, `tick`, `dispose`, `state`, `on(event)`; it imports no React,
   no DOM globals at module scope, and works in Node with the recording target.
2. Camera: pan, zoom 0.05–4.0, zoom-at-cursor, `fitToNodes(ids, padding)`, `zoomToSelection`,
   animated transitions using an injected easing and the injected scheduler (never `setTimeout`).
3. World↔screen transforms are pure functions with unit tests; no accumulated float drift over
   10,000 successive pan operations (assert the round-trip error stays < 1e-6).
4. Spatial index (R-tree) supporting ≥ 20,000 items with `query(rect)` p95 < 0.5 ms at 5,000 items;
   incremental update on node move (remove+insert of only the moved items, never a full rebuild).
5. Viewport culling: only nodes intersecting the viewport rect inflated by 200 px are considered
   for DOM mounting; everything else is not mounted (N1 depends on this).
6. LOD: `zoom ≥ 0.55` → DOM node hosts for visible nodes; `0.2 ≤ zoom < 0.55` → canvas-painted
   node glyphs (rounded rect, type accent, 1-line title if the box is ≥ 60 px wide);
   `zoom < 0.2` → dots clustered by the index. Thresholds live in one exported constant object.
7. During camera movement the engine holds a **stable "efficient zoom level"** for LOD decisions
   (quantized to 0.05 steps) so that a continuous zoom does not thrash DOM mount/unmount; the
   quantization is released 120 ms after the gesture ends.
8. Edges are always painted on canvas (never DOM/SVG), with straight lines in P2; real routing
   arrives in P5 behind the same `EdgePath` interface.
9. Interaction FSM with exactly these states: `idle`, `hover`, `pressPending`, `panning`,
   `marquee`, `draggingNodes`, `resizing`, `connecting` (stub in P2), `editing` (delegated to DOM),
   `spacePan`. Every transition is a pure reducer over `(state, event)`.
10. Drag threshold 4 px; `Escape` cancels any active gesture and restores the pre-gesture positions;
    `pointercancel` behaves identically. No mutation is committed before the threshold is crossed.
11. Selection: click, shift-click (toggle), marquee (intersect mode; alt = contain mode),
    `Ctrl/⌘+A`, `Escape` clears. Selection is an ordered set; the last-selected node is the
    "anchor" used by alignment operations.
12. Snapping: 8 px grid snap toggled by a setting, plus alignment guides against the 24 nearest
    nodes (edges and centers), with a 6 px capture distance and a rendered guide line.
13. Multi-node drag moves the whole selection with one transform; per-node positions are written
    once on drop (a single patch), not on every frame.
14. Minimap: renders the scene bounds and the viewport rect, supports click-to-jump and drag-to-pan,
    updates at most 10 fps (decoupled from the main loop).
15. Rendering budget: one `requestFrame` per frame maximum; no allocations inside the frame loop on
    the steady-state path (verified by a heap-growth assertion in the bench).
16. Device pixel ratio handled: canvas backing store scaled to DPR, capped at 2 for performance.
17. `dispose()` removes every listener, cancels every pending frame, disconnects observers and
    empties the DOM overlay; a leak test asserts zero listeners remain.

## 6 UX requirements

- Cursor states: default (arrow), hover-node (arrow), pressed-node (grabbing), space held (grab),
  panning (grabbing), marquee (crosshair), over resize handle (directional), over port (crosshair).
- Selection visuals: 1.5 px accent outline at 1× zoom, scaling inversely with zoom so the outline
  keeps constant screen width; multi-selection shows a bounding box with 8 resize handles.
- Hover feedback within one frame (≤ 16 ms) — hover is computed from the spatial index, not DOM.
- Marquee: 1 px accent border, 8 % accent fill; live count badge near the cursor ("12 selected").
- Panning has inertia only when `prefers-reduced-motion` is not set; otherwise motion stops on
  pointer-up.
- Zoom controls: bottom-right cluster (zoom out, percentage with a menu of 25/50/100/200/fit,
  zoom in), all keyboard-reachable; `⌘/Ctrl +/-/0` and `Shift+1` (fit) shortcuts.
- Empty board: centered, quiet teaching state ("Paste a link, drop a file, or press N for a note")
  drawn in DOM above the canvas, disappearing on the first node.
- Reduced motion: camera animations become instant jumps; no easing.

## 7 Technical requirements

- The engine owns no document state: it consumes a `Scene` and emits intents
  (`nodesMoved`, `selectionChanged`, `connectionRequested`); the host applies them to the document
  (P3 wires this to Yjs). This keeps N4 possible later.
- Canvas painting order: grid → edges → LOD nodes → selection outlines → alignment guides →
  marquee. Each layer is a function taking `(ctx, viewport, theme, scene)`.
- Use a single canvas element in P2. If profiling shows the grid dominating, split it into a second
  static canvas — document the decision in the PR, do not add layers speculatively.
- Text on canvas uses `ctx.textBaseline='middle'` and a measured-width cache keyed by
  `font+text.slice(0,64)` with an LRU of 2,000 entries.
- DOM overlay hosts are absolutely positioned with `transform: translate3d(x,y,0)` and
  `will-change: transform` only while dragging (permanent `will-change` costs memory per node).
- Node hosts are recycled from a pool keyed by node type to avoid mount/unmount churn during pans.
- All engine geometry uses plain numbers in world space; screen conversion happens once per frame.

## 8 Edge cases

- 0 nodes; 1 node; 5,000 nodes all overlapping at the same coordinate (index degeneracy).
- Node with zero or negative width/height → clamped to the minimum size, logged once per session.
- Extreme coordinates (±1e7) → camera clamps to scene bounds + 2,000 px margin.
- Rapid zoom in/out across LOD boundaries (thrash test): mount/unmount count must stay below 3× the
  number of visible nodes over a 100-frame scripted gesture.
- Browser tab hidden → the frame loop pauses (`visibilitychange`), resumes without a jump.
- Window resize and DPR change (moving to an external monitor) → backing store re-created once.
- Pointer leaves the window mid-drag and returns → drag continues coherently; releasing outside the
  window ends the drag (pointer capture).
- Trackpad pinch vs `Ctrl+wheel` vs plain wheel scroll must be distinguished per `05_CANVAS_ENGINE.md` §7.

## 9 Security requirements

- Node content is not rendered by the engine in this phase (only geometry and titles); any text
  drawn on canvas is truncated to 256 characters to bound work.
- DOM node hosts must never receive raw HTML in this phase; `textContent` only (rich content is
  P4 and will be sanitized there).
- The engine must not read or write `localStorage`, cookies or network — it is a pure rendering and
  interaction module (enforced by dependency-cruiser and a unit test stubbing globals).

## 10 Performance requirements

- N1 enforced from this phase: `pan-zoom-5000` p95 ≤ 16.6 ms, p99 ≤ 33 ms, `first-interactive-5000`
  ≤ 2,500 ms, `select-all-5000` ≤ 120 ms, `drag-200-selected` p95 ≤ 16.6 ms, `memory-5000` ≤ 700 MB.
- The bench gate becomes blocking (> 5 % regression fails the build).
- Hit-testing at 5,000 nodes ≤ 0.3 ms p95; index update on a 200-node drag ≤ 2 ms per drop.

## 11 Tests to write (named)

- `packages/canvas-engine/test/camera.test.ts` (transform round-trip, zoom-at-cursor, fit).
- `packages/canvas-engine/test/spatial-index.property.test.ts` (vs brute force, `18_TESTING.md` §4.4).
- `packages/canvas-engine/test/culling.test.ts`, `lod.test.ts` (thresholds, stable zoom level).
- `packages/canvas-engine/test/fsm.*.test.ts` — one file per gesture group; every transition plus
  `Escape`/`pointercancel` safety.
- `packages/canvas-engine/test/scene-snapshot.test.ts` (text snapshots, `18_TESTING.md` §5.4).
- `packages/canvas-engine/test/dispose.leak.test.ts`.
- `apps/web/src/canvas/CanvasHost.test.tsx` (mount/unmount, resize, DPR).
- `e2e/journeys/J04a-select-and-drag.spec.ts` (partial J4: select, drag, marquee).
- `bench/canvas.bench.ts` — all engine metrics real, baseline recorded.

## 12 Acceptance criteria (checkable)

1. A 5,000-node/10,000-edge scene pans and zooms at p95 ≤ 16.6 ms in the CI bench.
2. At `zoom = 0.3` no DOM node hosts are mounted; at `zoom = 1.0` only viewport-visible nodes are.
3. Marquee-selecting 200 nodes and dragging them produces exactly one document patch.
4. `Escape` mid-drag restores every node to its pre-drag position (unit + e2e).
5. Alignment guides appear within 6 px and snap deterministically (unit test with fixed positions).
6. Minimap click jumps the viewport; the viewport rect tracks the camera.
7. `dispose()` leaves zero listeners, zero pending frames, zero mounted hosts.
8. `pnpm test:engine` runs entirely in Node with no jsdom and no browser.

## 13 Definition of Done

Acceptance criteria pass; bench baseline committed; `packages/canvas-engine/README.md` documents the
public API, the `RenderTarget` seam and the LOD constants; visual snapshots `canvas-40-nodes-z1.0`
and `canvas-500-nodes-z0.3` added; coverage ≥ 85 % lines on the package; tracker ticked.

## 14 What NOT to break

P1's shell, routing, auth, CI jobs and token discipline. Do not introduce React into the engine, do
not move rendering into React components, do not add a canvas library (React Flow, tldraw, konva,
pixi) — the hybrid engine is a frozen decision (`00_MASTER.md` §2).

## 15 Documentation to update

`packages/canvas-engine/README.md`, `05_CANVAS_ENGINE.md` (correct any detail the implementation
proved wrong, in the same PR), `16_PERFORMANCE.md` (record measured numbers), tracker.

---

# P3 — Document & persistence

**Status: DONE** — implemented in `phase/p03-document-persistence`. `@nexus/domain` ships the board
`Y.Doc` schema (eight roots), the `tx(doc, origin, fn)` write path with the `no-direct-graph-write`
lint rule, zod entity schemas, observers, invariants, forward-only migrations, the origin-scoped
`Y.UndoManager` wrapper and the `raven.board.v1` export/import with a lossless round-trip property
test. `apps/web` ships `data/{docProvider,persistence,opfs,snapshots,syncStatus}`, the
document ⇄ engine bindings, the save indicator, undo/redo, version history and the import dialog;
`e2e/{persistence,undo}` cover kill-tab, offline and the undo matrix.

Deviation from §5.1 recorded here on purpose: rich text is stored in the top-level `richtext`
`Y.Map<Y.XmlFragment>` keyed by `fragmentKey` (referenced from `node.data.fragmentKey`), exactly as
`08_DATA_MODEL.md` §2.2.5 specifies, instead of a per-node `body` key. `08_DATA_MODEL.md` is the
single source of truth for the document schema.

## 1 Objective

Make the board a real document: define the `Y.Doc` schema, bind the canvas engine to it, persist
locally with `y-indexeddb` and OPFS, implement undo/redo with `Y.UndoManager`, add the
`Saved / Saving… / Offline` indicator, and add local snapshots plus board export/import (JSON v1)
satisfying N2, N3 and N9.

## 2 Context (what exists now)

P1: shell, auth, DB, CI. P2: a fully working canvas engine operating on an in-memory scene supplied
by factories, emitting intents rather than mutating anything. There is no persistence, no undo, no
sync (sync is P8; this phase is local-first only and must work with the network permanently off).

## 3 Existing architecture to respect

- `08_DATA_MODEL.md` §1–4 (Y.Doc schema, node/edge shapes, export format v1, migrations).
- `00_MASTER.md` §2 (Yjs document + Zustand for ephemeral UI only; `Y.UndoManager` scoped to the
  local origin; y-indexeddb + OPFS), §4 N2/N3/N8/N9.
- `05_CANVAS_ENGINE.md` §9 (engine intents → document mutations contract from P2).
- `18_TESTING.md` §4.1–4.2 (round-trip and convergence properties), §7.5 (offline e2e).
- `03_UX.md` §6 (save indicator, undo affordances, conflict copy).

## 4 Files/modules affected

```text
packages/domain/src/doc/{schema.ts,createBoardDoc.ts,observers.ts,transactions.ts,migrations.ts}
packages/domain/src/entities/{node.ts,edge.ts,group.ts,provenance.ts}
packages/domain/src/export/{exportBoard.ts,importBoard.ts,schema.v1.ts}
packages/domain/src/history/{undoManager.ts,origins.ts}
apps/web/src/data/{docProvider.tsx,persistence.ts,opfs.ts,syncStatus.ts,snapshots.ts}
apps/web/src/canvas/bindings/{sceneFromDoc.ts,applyIntents.ts}
apps/web/src/app/shell/SyncStatus.tsx
packages/domain/test/{export.property.test.ts,doc.convergence.property.test.ts,factories.ts}
e2e/persistence/{kill-tab.spec.ts,offline-basic.spec.ts}, e2e/undo/undo-matrix.spec.ts
```

## 5 Exact requirements (numbered, testable)

1. `Y.Doc` root structure, frozen here and referenced by every later phase:
   `nodes: Y.Map<Y.Map<any>>`, `edges: Y.Map<Y.Map<any>>`, `groups: Y.Map<Y.Map<any>>`,
   `meta: Y.Map<any>` (`schemaVersion`, `boardId`, `title`, `createdAt`), and per-node rich text as
   `Y.XmlFragment` stored under the node map key `body` (used from P4).
2. Node fields (`08_DATA_MODEL.md` §2): `id`, `type`, `x`, `y`, `w`, `h`, `z`, `data` (typed per
   node type), `tags` (`Y.Array<string>`), `provenance` (`source`, `tool`, `runId`, `observedAt`,
   `confidence`), `createdAt`, `updatedAt`. Zod schemas validate at every boundary (import, paste,
   API), not on every keystroke.
3. Every mutation goes through `transact(doc, origin, fn)` in `transactions.ts`; direct `Y.Map.set`
   outside `packages/domain/src/doc` is banned by the `no-direct-graph-write` ESLint rule (N4's
   foundation).
4. `Y.UndoManager` tracks the three root maps, `captureTimeout: 400 ms`, and filters by origin so
   remote changes are never undone locally (N3). Undo stack depth ≥ 200 operations.
5. Undo/redo bound to `⌘/Ctrl+Z` and `⌘/Ctrl+Shift+Z`, disabled-with-reason when the stack is empty,
   and exposed as commands for the future palette.
6. Local persistence with `y-indexeddb` per board (`raven-board-<id>`), attaching before first
   render; the app opens a previously visited board with zero network.
7. Durability: a mutation is written to IndexedDB within 100 ms (N2) — measured by a test that
   mutates, waits 100 ms, kills the provider and re-reads.
8. Binary blobs (images, files) are stored in OPFS under `/boards/<boardId>/<fileId>` with a
   metadata record in the doc; OPFS access is wrapped so a browser without OPFS falls back to
   IndexedDB blobs with a one-time warning.
9. Save indicator states: `Saved` (idle, all local writes flushed), `Saving…` (pending local or
   server write), `Offline` (no connectivity; local writes still flushing), `Error` (persistence
   failed — with a retry action and an export-to-file escape hatch). Server states arrive in P8;
   the component and the state machine ship now.
10. Snapshots: on every 200 operations or every 5 minutes of activity, store a compacted
    `Y.encodeStateAsUpdate` in IndexedDB with a timestamp; keep the last 20; expose a "Version
    history" list that can preview and restore a snapshot (restore creates a new operation, it
    never rewrites history).
11. Export: `exportBoard(doc) → BoardExportV1` (JSON, stable key order, sorted arrays) including
    nodes, edges, groups, meta, and referenced file manifests (with content hashes; bodies are
    included only in the `.raven` zip variant).
12. Import: `importBoard(json)` validates with zod, runs the migration chain from
    `schemaVersion < current`, remaps IDs when importing into a board that already has nodes, and
    returns a report (`created`, `skipped`, `remapped`, `warnings`).
13. Round-trip is lossless (N9) including unknown fields inside `data` (forward compatibility).
14. The canvas engine is bound to the doc via `sceneFromDoc` (observer-driven incremental patches,
    never a full rebuild on every change) and `applyIntents` (engine intents → transactions).
15. Doc size guard: warn the user at 4,000 nodes, hard-block node creation at 20,000 with a clear
    message (protects N1 and memory).

## 6 UX requirements

- Save indicator sits in the top bar, always visible, with a tooltip explaining the current state
  and the time of the last successful save ("Saved locally 3 s ago").
- Undo/redo buttons next to it, with the name of the operation in the tooltip ("Undo: move 12 nodes").
- Version history panel: list of snapshots with relative time and node/edge deltas; preview renders
  the snapshot read-only on the canvas with a "Restore this version" primary action and a clear
  "You are previewing a version" banner.
- Import dialog: file picker or drop zone → validation → a summary of what will be imported →
  explicit confirm. Never import silently on drop (N8's spirit).
- Errors: persistence failure shows what happened (storage quota, private mode), why it matters,
  and what to do (free space / export the board to a file now).
- Undo after a destructive action shows a toast with an inline "Undo" for 8 seconds.

## 7 Technical requirements

- The doc provider mounts before the canvas and provides `{ doc, undoManager, status, boardId }`
  via context; Zustand holds only ephemeral UI (selection is engine state, panel open/closed, tool
  mode) and is never persisted.
- Observers translate Yjs events into engine patches with O(changed) work; a full scene rebuild is
  allowed only on initial load and on snapshot restore.
- `origins.ts` defines the origin constants: `LOCAL_USER`, `LOCAL_IMPORT`, `REMOTE`, `SYSTEM`.
  UndoManager tracks `LOCAL_USER` and `LOCAL_IMPORT` only.
- Rich text uses `Y.XmlFragment` from the start so P4's editor binds without a migration.
- IndexedDB writes are batched by the provider; no custom debouncing that could delay past 100 ms.
- Export is deterministic: same doc → byte-identical JSON (needed for the property test and for
  meaningful diffs).

## 8 Edge cases

- Storage quota exceeded → `Error` state, an immediate export offer, and no data loss in memory.
- Private/incognito mode without IndexedDB → the app runs in memory-only mode with a persistent
  warning banner and a forced export prompt before closing (beforeunload).
- Two tabs on the same board (same browser) → both bind to the same IndexedDB; y-indexeddb keeps
  them consistent; the test asserts convergence without a server.
- Corrupt IndexedDB payload → detected on load, the board opens from the newest valid snapshot, and
  the corrupt payload is preserved under a `-corrupt` key for support.
- Importing a file with 50,000 nodes → rejected with a clear limit message before any mutation.
- Importing a board that references files not present in the archive → nodes import with a
  "missing file" state, never a crash.
- Undo across a snapshot restore → restore is a normal operation and is itself undoable.
- Clock skew / duplicate `createdAt` values must never be used as an ordering key; use the CRDT's
  ordering and `id` as a tiebreak.

## 9 Security requirements

- Import validates every field with zod before it touches the doc; unknown node `type` values are
  imported as `unknown` nodes rendered as a generic card, never executed or trusted.
- No HTML from an import is rendered; rich text is stored as structured Yjs XML and sanitized on
  render (P4).
- File manifests carry a SHA-256; on import the hash is verified before the blob is used.
- OPFS paths are derived from server-issued IDs only; user-supplied filenames are metadata only.
- Export never includes session tokens, user emails beyond display names, or org secrets.

## 10 Performance requirements

- Board with 5,000 nodes: initial doc load + first paint ≤ 2.5 s (N1) including IndexedDB read.
- Applying a 200-node move patch: ≤ 8 ms of main-thread work.
- Export of a 5,000-node board ≤ 1.2 s; import ≤ 2 s (both measured in the bench).
- IndexedDB write amplification: a single node move produces ≤ 2 KB of update payload.

## 11 Tests to write (named)

- `packages/domain/test/export.property.test.ts` (N9 round-trip, idempotence, unknown fields).
- `packages/domain/test/doc.convergence.property.test.ts` (two replicas, interleavings, dangling
  edge pruning).
- `packages/domain/test/migrations.test.ts` (v0→v1 chain with fixtures).
- `packages/domain/test/undo.origins.test.ts` (remote changes are not undone).
- `apps/web/src/data/persistence.test.ts` (durability timing, quota error path).
- `e2e/persistence/kill-tab.spec.ts` (N2), `e2e/persistence/offline-basic.spec.ts`.
- `e2e/undo/undo-matrix.spec.ts` (one case per mutation type existing so far; extended every phase).
- `e2e/journeys/J06-rich-text-reload.spec.ts` (placeholder text node version; full editor in P4).

## 12 Acceptance criteria (checkable)

1. Create 10 nodes, kill the tab within 100 ms of the last edit, reopen: all 10 are present.
2. With the network disabled for the whole session, every board feature of P2/P3 works.
3. Undo reverses every mutation type introduced so far, redo restores it, 200 levels deep.
4. Export → import into a fresh board produces a deep-equal document (property test green).
5. Snapshot restore is previewable and undoable.
6. The save indicator never shows `Saved` while a write is pending (asserted by a fake-timer test).
7. A 5,000-node board opens from IndexedDB in ≤ 2.5 s.

## 13 Definition of Done

Acceptance criteria pass; `08_DATA_MODEL.md` updated with any schema detail that changed;
`packages/domain/README.md` documents the doc schema, origins and export format; undo matrix and
offline suites are part of CI; tracker ticked.

## 14 What NOT to break

The engine's independence (it still must not know about Yjs — bindings live in `apps/web`), N1
performance, P1 auth/CI. Do not add a server round-trip to any local operation; P3 must be fully
functional offline.

## 15 Documentation to update

`08_DATA_MODEL.md`, `packages/domain/README.md`, `03_UX.md` §6 if indicator copy changed,
`18_TESTING.md` §4 if new properties were added, tracker.

---

# P4 — Node system

## 1 Objective

Implement every node type with its schema, renderer, inspector editor and lifecycle: website, text,
image, file, link, note/evidence, person/username, project/repository, plus the generic `unknown`
fallback. Add rich text editing, file/image handling with upload, tagging, and the node inspector
panel.

## 2 Context (what exists now)

P2 renders geometry and titles only; P3 stores nodes in the `Y.Doc` with a `data` blob per type and
a `Y.XmlFragment` `body` field reserved for rich text. There is no per-type UI, no upload path, no
inspector. File storage exists locally in OPFS (P3); server-side upload is introduced here.

## 3 Existing architecture to respect

- `06_NODE_SYSTEM.md` (registry, per-type schemas, editors, lifecycle) — the primary reference.
- `08_DATA_MODEL.md` §2 (node fields, provenance), `03_UX.md` §4 (inspector), §7 (node states).
- `05_CANVAS_ENGINE.md` §6 (LOD: what a node must render at each level).
- `09_BACKEND.md` §4 (files: presigned upload, type sniffing, thumbnails), `15_SECURITY.md` §5.
- `04_DESIGN_SYSTEM.md` (card anatomy, density, typography scale).

## 4 Files/modules affected

```text
packages/domain/src/nodes/{registry.ts,types/*.ts,schemas.ts,defaults.ts,lifecycle.ts}
packages/ui/src/primitives/{Card,Badge,Tag,Field,Select,Tooltip,ContextMenu}/*
apps/web/src/nodes/{NodeRenderer.tsx,renderers/*.tsx,inspector/{Inspector.tsx,editors/*.tsx}}
apps/web/src/nodes/richtext/{Editor.tsx,extensions.ts,serialize.ts}
apps/web/src/files/{upload.ts,useUpload.ts,thumbnails.ts}
apps/api/src/trpc/routers/files.ts, apps/api/src/files/{presign.ts,sniff.ts}
apps/worker/src/jobs/thumbnail.ts
packages/canvas-engine/src/render/lod-glyphs.ts (per-type accent + glyph)
```

## 5 Exact requirements (numbered, testable)

1. A node type registry: `defineNodeType({ id, label, icon, schema, defaults, minSize, maxSize,
render, editor, lodGlyph, searchText, exportFields })`. Adding a type touches only the registry
   directory — no `switch` statements anywhere else (a lint test greps for type-name switches).
2. Types and their required `data` fields:
   - `website`: `url`, `title`, `description?`, `faviconFileId?`, `screenshotFileId?`, `siteName?`,
     `fetchedAt?`, `status` (`pending|ok|failed`).
   - `text`: rich text in `body` only.
   - `image`: `fileId`, `width`, `height`, `alt?`, `exif?` (with a GPS flag surfaced in the UI).
   - `file`: `fileId`, `filename`, `mime`, `size`, `pages?`, `previewFileId?`.
   - `link`: `url`, `label?` (a bare URL with no unfurl).
   - `note`: rich text + `severity` (`info|finding|critical`) + optional `sourceRef`.
   - `person`: `displayName`, `usernames[]`, `emails[]`, `notes?`, `confidence`.
   - `repo`: `provider`, `owner`, `name`, `url`, `stars?`, `language?`, `defaultBranch?`, `analysis?`.
   - `unknown`: preserves the original payload verbatim and renders it read-only as JSON.
3. Every type has: a DOM renderer (near zoom), a canvas LOD glyph (mid zoom), an inspector editor,
   a `searchText(node)` function (used by P7), and export mapping.
4. Rich text editor (TipTap over `Y.XmlFragment`) with: bold, italic, strikethrough, inline code,
   H2/H3, bullet/ordered lists, task lists, blockquote, code block, link, and `@`-mention of another
   node (creating a typed `references` edge on accept). No images inside rich text (images are nodes).
5. Editing happens in place on the canvas (double-click or `Enter` on selection) and in the
   inspector; both bind to the same `Y.XmlFragment` and must not conflict (test with both open).
6. Inspector panel (right, 360 px, collapsible, resizable 320–560 px) shows: type, title, the type
   editor, tags, provenance block (source/tool/run/observed/confidence with a link to the run), the
   connections list (incoming/outgoing edges with types), and metadata (created/updated/id, copyable).
7. Tags: free-form, deduplicated case-insensitively, max 32 per node, max 48 chars each; an
   autocomplete from existing board tags; tags render as chips on the card at zoom ≥ 0.8.
8. Files: presigned direct upload to S3/MinIO; the client computes SHA-256 while uploading;
   server-side type sniffing on completion (magic bytes) rejects mismatches; thumbnails generated by
   a worker job (`image` → 480 px webp, `pdf` → first page 480 px).
9. Upload UX: progress per file, cancel, retry with backoff, and a queue of at most 4 concurrent
   uploads; on failure the node stays with a `failed` state and a retry action, never disappears.
10. Node lifecycle: `create` (with provenance `source: 'manual'`), `update`, `duplicate` (offset by
    24 px, new IDs, provenance `source: 'duplicate'`, `derivedFrom` set), `delete` (soft in the doc:
    removal is a CRDT delete but undoable), `convert` (link → website, text → note) with an explicit
    confirm when data would be lost.
11. Node sizing: each type has a default size and a `min`/`max`; text-based nodes support autosize
    to content up to 640 px height, then scroll internally.
12. Every node renders in exactly these states: default, hover, selected, multi-selected, dragging,
    editing, loading (unfurl/upload/analysis in progress), error, and stale (`fetchedAt` older than
    30 days shows a subtle indicator).

## 6 UX requirements

- Card anatomy per `04_DESIGN_SYSTEM.md`: 12 px radius, 1 px border, type accent as a 3 px left
  edge, 12/16 px padding, title 14 px/600, secondary 12 px/400, max 3 lines of preview text.
- Hover reveals a compact action bar (open source, copy link, add edge, more menu) anchored to the
  card top-right; it never shifts layout.
- Image nodes: object-fit cover with the natural aspect preserved on resize (shift = free resize);
  a loading blur-up placeholder using the stored dominant color.
- Website nodes: favicon + domain line, title, description clamp, and a "fetched N ago" footnote.
- Person nodes: avatar-less initials block, username chips with per-platform icons for known hosts.
- Inspector empty state (no selection): shows board-level info and a hint about multi-select.
- Multi-selection inspector: shows shared fields only (tags, type-common actions) with a count.
- Every editable field: label, help text where non-obvious, inline validation on blur, and undo via
  the global undo (not per-field).
- Errors are specific: "Upload failed — the file is 142 MB, the limit is 100 MB. Compress it or link
  it instead."

## 7 Technical requirements

- Node renderers are pure presentational components receiving a plain node object; they never read
  the Y.Doc directly (the binding layer supplies props) to keep re-renders bounded.
- Re-render isolation: a node re-renders only when its own map changes; verify with a render-count
  test on a 200-node board where one node is edited.
- Rich text serialization to plain text for search and export is deterministic and tested.
- Sanitization: any HTML derived from unfurl or import is sanitized with a strict allowlist before
  render; `dangerouslySetInnerHTML` is banned except in the single audited sanitizer component.
- EXIF is parsed in a worker; GPS coordinates are retained (OSINT-relevant) but never auto-used to
  create map nodes without a user action.
- Thumbnail jobs are idempotent by `fileId + variant`.

## 8 Edge cases

- Paste of a 50 MB image → progress, and a warning that it will be downscaled for preview.
- Unsupported file type → the node is created as `file` with a generic icon; no preview, no error.
- Image with 20,000 × 20,000 pixels → rejected at decode with a clear message (decompression bomb).
- Rich text with 200 KB of content → editor stays responsive (virtualized? no — cap at 200 KB with a
  warning at 150 KB; justify: rich text nodes are notes, not documents).
- Two users editing the same rich text (P8) must not lose characters — the Y.XmlFragment binding is
  the reason; assert in the P8 collab tests.
- Deleting a node that is referenced by an `@`-mention → the mention renders as "deleted node" and is
  restorable by undo.
- Tag with only whitespace or an emoji-only tag → allowed if non-empty after trim; length enforced.

## 9 Security requirements

- Upload constraints: ≤ 100 MB per file, allowlist of MIME types (`image/png|jpeg|webp|gif`,
  `application/pdf`, `text/plain`, `text/csv`, `application/json`, `application/zip`), sniffed
  server-side; SVG is rejected (`15_SECURITY.md` §5).
- Files are served from a separate origin/bucket path with `Content-Disposition: attachment` for
  non-image types and `X-Content-Type-Options: nosniff`.
- Presigned URLs expire in 10 minutes and are scoped to a single key and method.
- Any URL field is validated by the shared URL validator (P6 introduces `safeFetch`; the validator
  for _storage_ of URLs already applies scheme + shape rules here).
- Filenames are sanitized for display; storage keys are server-generated.

## 10 Performance requirements

- 500 visible rich cards render in ≤ 120 ms after a viewport jump (measured in the bench).
- Editing a node's text does not re-render any other node (render-count assertion = 1).
- Thumbnails are requested lazily for nodes within 400 px of the viewport.
- Inspector open/close ≤ 100 ms with no canvas frame drop (no layout thrash).

## 11 Tests to write (named)

- `packages/domain/test/nodes.registry.test.ts` (every type has all required capabilities).
- `packages/domain/test/nodes.schemas.property.test.ts` (schema round-trips through export).
- `apps/web/src/nodes/renderers/*.test.tsx` (state tables per `18_TESTING.md` §6).
- `apps/web/src/files/upload.test.ts` (progress, cancel, retry, hash, failure states).
- `apps/api/test/files.sniff.test.ts` (upload corpus, `18_TESTING.md` §11.2).
- `apps/web/src/nodes/richtext/serialize.test.ts`.
- `e2e/journeys/J03-drop-file.spec.ts`, `e2e/journeys/J06-rich-text-reload.spec.ts`.
- `e2e/visual/nodes.spec.ts` (node-type × state snapshot matrix).

## 12 Acceptance criteria (checkable)

1. Each of the nine node types can be created, edited, duplicated, deleted and undone.
2. A dropped 5 MB PDF produces a `file` node with a page-1 thumbnail within 10 s.
3. Rich text survives reload, and formatting round-trips through export/import.
4. The inspector shows provenance for a node and links to its run (link inert until P9).
5. The upload corpus passes: every hostile file is rejected with a specific message.
6. Editing one node on a 200-node board triggers exactly one node re-render.
7. Visual snapshots for all node states are committed and reviewed.

## 13 Definition of Done

Acceptance criteria pass; `06_NODE_SYSTEM.md` reflects the shipped schemas exactly; the node type
registry is documented for plugin authors (feeds `17_PLUGIN_SDK.md`); undo matrix extended with node
operations; tracker ticked.

## 14 What NOT to break

N1 performance (rich cards are the main risk — keep DOM nodes bounded by culling), P3 persistence
and undo semantics, engine/React separation. Do not put node-type conditionals inside the engine;
the engine only receives an accent color and a glyph id.

## 15 Documentation to update

`06_NODE_SYSTEM.md`, `packages/domain/README.md`, `packages/ui/README.md` (card primitives),
`15_SECURITY.md` §5 (upload policy as shipped), tracker.

---

# P5 — Edge system

## 1 Objective

Implement typed edges with four routing modes (curved, orthogonal, straight, smart), labels,
directionality, creation and editing interactions, waypoints, and edge selection/inspection — with
routing running in a worker and meeting the 10,000-edge performance budget.

## 2 Context (what exists now)

P2 paints straight canvas lines through an `EdgePath` interface; P3 stores edges in the doc; P4 gave
nodes ports implicitly (edges attach to node borders). There is no edge type semantics, no routing,
no labels, no edge editing UI.

## 3 Existing architecture to respect

- `07_EDGE_SYSTEM.md` (semantics, routing algorithms, labels, editing) — primary reference.
- `05_CANVAS_ENGINE.md` §4 (render order), §7 (the `connecting` FSM state reserved in P2).
- `08_DATA_MODEL.md` §2 (edge fields), `18_TESTING.md` §4.3 (routing invariants).
- `04_DESIGN_SYSTEM.md` (edge colors per type, stroke widths, label chips).

## 4 Files/modules affected

```text
packages/domain/src/edges/{types.ts,semantics.ts,validation.ts,defaults.ts}
packages/canvas-engine/src/edges/{router.worker.ts,routing/{curved,orthogonal,straight,smart}.ts,
  cache.ts,hit-test.ts,labels.ts,anchors.ts}
packages/canvas-engine/src/render/canvas-layer.ts (edge painting, arrowheads, selection)
apps/web/src/edges/{EdgeInspector.tsx,EdgeContextMenu.tsx,ConnectionOverlay.tsx}
packages/domain/test/edges.routing.property.test.ts
```

## 5 Exact requirements (numbered, testable)

1. Edge types (closed union, extensible via the plugin registry later): `references`,
   `related_to`, `derived_from`, `owns`, `has_account`, `member_of`, `mentions`, `contradicts`,
   `same_as`, `custom` (with a user label). Each has: color token, default routing, directionality
   (directed/undirected), and whether it is inferred (tool/AI) or asserted (user).
2. Edge record: `id`, `source`, `target`, `sourceAnchor?`, `targetAnchor?`, `type`, `label?`,
   `routing` (`curved|orthogonal|straight|smart`), `waypoints[]`, `style?` (dashed for inferred),
   `provenance`, timestamps.
3. Creation: drag from a node's edge/port zone (a 10 px band around the card border) to another
   node; dropping on empty canvas opens a quick menu ("New note here and connect", "Cancel").
   `Escape` cancels; the connection preview follows the pointer with the active routing mode.
4. Anchors: `auto` (default; the router picks the best of 8 anchor points minimizing path length and
   crossings) or pinned by the user by dragging the endpoint onto a specific side.
5. Routing algorithms:
   - `straight`: node center to node center, clipped to borders.
   - `curved`: cubic bezier with control points offset along the anchor normal by
     `clamp(distance * 0.35, 32, 180)` px.
   - `orthogonal`: axis-aligned Manhattan path with 12 px corner radii, minimum 24 px stub off each
     anchor, choosing the variant with fewer bends and no node overlap.
   - `smart`: A\* on a sparse visibility grid built from the obstacle rectangles within the bounding
     box of the two endpoints inflated by 120 px; cell size 16 px; obstacle padding 12 px; bend
     penalty 12; budget 4 ms per edge — on budget exhaustion return the `curved` path with
     `degraded: true`.
6. Routing runs in a dedicated worker (`router.worker.ts`), batched per frame, with results cached
   by a key of `(sourceRect, targetRect, mode, waypoints, obstacleVersion)`. Cache hit ratio must
   exceed 90 % during a drag of unrelated nodes.
7. During a node drag, edges connected to the dragged nodes re-route with the cheap `curved`
   approximation and settle to their real mode on drop (keeps 60 fps at 10,000 edges).
8. Waypoints: double-click on an edge inserts a waypoint at that point; drag to move; right-click to
   delete; waypoints force `orthogonal`/`smart` paths through them in order.
9. Labels: optional text chip at the path midpoint (or at the largest straight segment for
   orthogonal), background token surface, 11 px text, max 48 chars displayed with ellipsis, hidden
   below zoom 0.6, and never overlapping (a simple label collision pass shifts labels along the path
   by up to 24 px, then hides the lower-priority one).
10. Selection and hit-testing: edge hit area is the path stroke inflated to 10 px; clicking selects
    the edge; `Delete` removes it (undoable); multi-select supports edges and nodes together.
11. Edge inspector: type picker (with the semantics description), direction toggle, routing mode,
    label field, provenance block, and "Reverse direction" / "Split with a node between" actions.
12. Validation: no self-loops in P5 (a self-loop attempt shows a specific message); duplicate edges
    of the same type between the same pair are prevented (offer "edit the existing edge" instead).
13. Arrowheads: 8 px triangle for directed types; `same_as` renders as a double-ended plain line;
    `contradicts` renders with a small crossing tick at the midpoint.

## 6 UX requirements

- Hovering a node shows the connection affordance (a subtle border highlight plus a `+` handle on
  each side) after a 120 ms delay so it does not flicker during pans.
- While connecting, valid drop targets brighten and invalid ones dim to 40 % opacity; the cursor
  carries a chip naming the edge type that will be created.
- Edge hover raises its stroke width by 1 px and shows the label even below the zoom threshold.
- Selected edge shows its endpoints as draggable dots and its waypoints as small squares.
- Changing the routing mode animates the path over 160 ms (skipped under `prefers-reduced-motion`).
- Right-click on an edge: change type (submenu), reverse, add label, add waypoint, delete.
- Keyboard: with a node selected, `C` starts a connection and Tab cycles candidate targets by
  proximity, `Enter` confirms — full keyboard operability (N6).
- Empty/edge cases: connecting to a node that is offscreen auto-pans at 600 px/s when the pointer is
  within 40 px of the viewport border.

## 7 Technical requirements

- `EdgePath` is a `Float32Array` of points plus a `kind` discriminator; the renderer never allocates
  per frame (paths are reused from the cache).
- The obstacle set for smart routing is queried from the spatial index, not from a full node list.
- Routing results are versioned by `obstacleVersion`, bumped on any node geometry change, so stale
  paths are never drawn.
- Worker communication uses transferable `ArrayBuffer`s; the main thread never blocks on routing.
- Determinism: identical inputs produce identical arrays (required by the property test and the
  visual snapshots).
- Edge painting batches by style: one `beginPath` per (color, width, dash) group.

## 8 Edge cases

- Two nodes overlapping exactly → path degenerates to a small arc; must not produce NaN.
- 10,000 edges with `smart` routing requested → the batch scheduler processes at most 400 edges per
  frame, prioritizing visible edges; offscreen edges keep their previous path.
- Node deleted while an edge to it is being drawn → the connection cancels cleanly.
- Waypoint dragged onto a node → allowed (the path passes over the node) but flagged in the
  inspector as "waypoint inside a node".
- Extremely long edges (> 20,000 px) → smart routing falls back to curved (grid would be too large).
- Circular reference chains (A→B→C→A) are legal; the UI must not attempt to prevent them.
- Undo of an edge type change restores the previous type and label together (one transaction).

## 9 Security requirements

- Edge labels are plain text, length-capped at 200 stored characters, escaped on canvas (no HTML).
- Custom edge types created by users are stored as data, never evaluated; their labels are sanitized.
- Provenance on tool/AI-created edges is mandatory; a validation test asserts an edge cannot be
  created through `applyProposal` without it (prepares P9).

## 10 Performance requirements

- 10,000 edges, curved mode: full repaint ≤ 6 ms; combined with nodes the frame stays ≤ 16.6 ms.
- `route-smart-2000-edges` bench ≤ 900 ms wall time in the worker.
- Dragging 200 nodes with 1,000 attached edges keeps p95 ≤ 16.6 ms.
- Routing cache hit ratio ≥ 90 % during typical panning (asserted in the bench output).

## 11 Tests to write (named)

- `packages/domain/test/edges.validation.test.ts` (self-loop, duplicates, type rules).
- `packages/canvas-engine/test/routing/*.test.ts` per algorithm (geometry assertions).
- `packages/domain/test/edges.routing.property.test.ts` (all six invariants, `18_TESTING.md` §4.3).
- `packages/canvas-engine/test/edges.cache.test.ts` (invalidation on obstacle version bump).
- `packages/canvas-engine/test/edges.hit-test.test.ts`.
- `apps/web/src/edges/EdgeInspector.test.tsx` (state table).
- `e2e/journeys/J04-connect-nodes.spec.ts` (full J4 including label and routing change).
- `e2e/visual/edges.spec.ts` (4 routings × 3 states).

## 12 Acceptance criteria (checkable)

1. All four routing modes render correctly for the same node pair and can be switched live.
2. Smart routing avoids obstacles or reports `degraded` — never draws through a node silently.
3. Dragging an edge endpoint re-anchors it; dropping on empty canvas offers node creation.
4. Labels never overlap in the visual snapshot scene.
5. `route-smart-2000-edges` meets its budget; the frame budget holds at 10,000 edges.
6. Every edge operation is undoable in one step.
7. Keyboard-only connection creation works end to end.

## 13 Definition of Done

Acceptance criteria pass; `07_EDGE_SYSTEM.md` matches the implementation including the exact
constants; routing invariants are in the property suite; visual snapshots committed; tracker ticked.

## 14 What NOT to break

N1 frame budget, node rendering isolation from P4, undo semantics, engine purity (routing lives in
the engine package and its worker, with no domain imports beyond types).

## 15 Documentation to update

`07_EDGE_SYSTEM.md`, `packages/canvas-engine/README.md` (worker protocol), `16_PERFORMANCE.md`
(measured routing numbers), tracker.

---

# P6 — Capture

## 1 Objective

Make collection frictionless: a paste pipeline that always produces the right node type, drag-and-
drop from the OS and other browser tabs, a server-side unfurl service with SSRF protection, a quick-
add command, and the browser-extension hook endpoint.

## 2 Context (what exists now)

P4 defined node types including `website` with a `status: pending` state and `fetchedAt`; P5 gives
edges. Nothing populates website metadata yet; there is no clipboard handling and no outbound HTTP
from the server other than auth/OAuth.

## 3 Existing architecture to respect

- `03_UX.md` §3 (paste as the front door), `06_NODE_SYSTEM.md` (target node shapes).
- `09_BACKEND.md` §5 (unfurl job, queue, caching), `15_SECURITY.md` §4 (SSRF rules — mandatory).
- `00_MASTER.md` §4 N7 (SSRF-safe URL handling with DNS pinning, denylist, redirect cap).
- `18_TESTING.md` §11.1 (the SSRF corpus that must pass), §7.4 (fixture web server for e2e).

## 4 Files/modules affected

```text
packages/domain/src/capture/{detect.ts,parse.ts,plan.ts}      clipboard payload → node plan
packages/domain/src/net/{safeFetch.ts,urlValidator.ts,dnsPin.ts}
apps/web/src/capture/{usePaste.ts,useDropZone.ts,QuickAdd.tsx,PasteToast.tsx}
apps/api/src/trpc/routers/unfurl.ts, apps/api/src/rest/extension.ts
apps/worker/src/jobs/unfurl.ts, apps/worker/src/jobs/screenshot.ts (optional, flagged off)
packages/domain/test/{ssrf.corpus.test.ts,capture.detect.test.ts}
e2e/fixtures-server/**
```

## 5 Exact requirements (numbered, testable)

1. Paste detection order (first match wins), implemented as a pure function over `DataTransfer`:
   files → image bitmap → `text/html` (with a URL or rich content) → `text/uri-list` → plain text
   that parses as one or more URLs → plain text → nothing (show "Nothing to paste").
2. Multi-URL paste (a list of N URLs, up to 50) creates N nodes laid out in a grid at the cursor,
   with a single undo entry and a single toast ("Added 12 links — Undo").
3. Pasted plain text ≤ 280 chars creates a `text` node sized to content; longer creates a `note`.
4. Pasted images become `image` nodes with an immediate local preview (OPFS) while the upload runs.
5. Drag-and-drop supports: OS files (multiple), an image dragged from another tab, a link dragged
   from the address bar or a page, and internal node re-parenting into groups (P15 wires groups).
6. A drop shows a live insertion indicator at the cursor and an outline of the drop zone.
7. Unfurl service: `POST /trpc/unfurl.fetch { url }` enqueues a job (or returns cache), the worker
   fetches with `safeFetch`, extracts `title`, `description`, `siteName`, `canonicalUrl`, `favicon`,
   `ogImage`, `publishedAt`, `author`, and stores favicon/og-image as files.
8. Unfurl cache: keyed by normalized URL, TTL 7 days, negative cache 1 h for failures; a manual
   "Refresh" action bypasses the cache.
9. `safeFetch` (the only outbound HTTP path in the product, all services): scheme allowlist
   (`http`, `https`), port allowlist (80, 443, 8080, 8443), DNS resolution + private/link-local/
   CGNAT/loopback/unique-local denylist, **connect to the resolved and validated IP** (pinning, no
   re-resolution), redirect cap 5 with re-validation at every hop, 10 s total timeout, 10 MB body
   cap, `Content-Type` allowlist, no credentials/cookies forwarded, and a distinct error code per
   rejection reason.
10. The URL validator additionally rejects userinfo in the authority, IDN homograph confusables
    (normalize to punycode and reject mixed-script labels), and non-normalized encodings.
11. Quick-add: `N` creates a note at the cursor, `L` opens a one-field URL input, `⌘/Ctrl+V` pastes,
    and a "+" button opens the same menu for pointer users.
12. Browser-extension hook: `POST /api/v1/capture` accepting `{ url, title?, selection?, imageUrl?,
boardId? }` authenticated by a scoped API token; it creates a node in the target board's inbox
    area (a reserved region 2,000 px left of the origin) and returns the node id. Rate limit 60/min.
13. Every captured node records provenance: `source: 'paste'|'drop'|'extension'|'quick-add'`, the
    original URL, and `observedAt`.
14. Screenshot capture of a website node is implemented behind the `capture.screenshot` feature flag
    (off by default) because it requires a headless browser in the worker; when off, the UI does not
    offer it (no dead controls).

## 6 UX requirements

- Paste feedback within 100 ms: the node appears immediately in a `loading` state; metadata fills in
  when the unfurl returns. Never block the paste on the network.
- Paste position: at the pointer if it is over the canvas, else at the viewport center; multi-item
  pastes lay out in a grid with 24 px gaps, avoiding overlaps with existing nodes.
- A toast summarizes what happened with an Undo action for 8 s.
- Unfurl failure: the node stays as a `link` node with the URL, a "Couldn't fetch this page —
  the site blocked the request" message, and a Retry action. Blocked-by-policy shows a distinct
  message: "This address is not reachable from the server (private network)".
- Drop zone: a full-canvas dashed overlay with the count and types of files being dropped.
- Quick-add URL input validates as you type and shows the detected node type before confirming.
- Clipboard permission denied (Safari/Firefox variations) → a fallback modal with a paste target
  field and a clear explanation.

## 7 Technical requirements

- Detection is a pure function tested with synthetic `DataTransfer` fixtures; the React hook is a
  thin wrapper.
- Unfurl parsing uses a streaming HTML parser with a 512 KB head limit — the full body is never
  buffered for metadata.
- Favicon resolution order: `link[rel=icon]` variants → `/favicon.ico` → domain fallback glyph.
- Job dedupe: concurrent unfurls of the same URL collapse into one job (BullMQ job id = URL hash).
- The extension endpoint is REST + OpenAPI (`00_MASTER.md` §2), versioned under `/api/v1`.
- All capture paths create nodes through the same domain function `createNodesFromPlan`, so paste,
  drop and extension cannot diverge in behavior.

## 8 Edge cases

- Paste of 500 URLs → capped at 50 with a message offering "Import as a list" (creates one node
  containing the list) — no silent truncation.
- Paste of an image plus text (e.g. from a document) → image wins, text is attached as the node's
  `alt`/caption.
- A URL that redirects to a private IP → blocked at the hop with the policy message (SSRF e2e).
- A page with no title → the node title falls back to the domain + path.
- A 30-second-slow server → aborted at 10 s, node stays as `link` with a retry.
- Duplicate paste of an existing URL → the node is still created, but a subtle badge offers "3
  nodes share this URL — review duplicates" (dedupe UI is P13).
- Offline paste → nodes are created locally in `pending` state; unfurl jobs are enqueued when
  connectivity returns (queued in the doc as a `pendingFetch` flag).
- File dropped while offline → stored in OPFS, uploaded on reconnect.

## 9 Security requirements

- The SSRF corpus (`18_TESTING.md` §11.1) must pass in full; every new URL consumer must call
  `safeFetch` (ESLint bans direct `fetch` with a non-literal URL in server packages).
- The unfurl worker runs with egress through the allowlisting proxy (`19_DEPLOYMENT.md` §3), so a
  bypass of `safeFetch` still cannot reach internal services.
- Extracted metadata is treated as untrusted: sanitized, length-capped (title 300, description 1,000),
  and never rendered as HTML.
- Extension API tokens are scoped (`capture:write` only), hashed at rest, revocable, and last-used
  timestamps are recorded.
- Uploaded remote images pass the same sniffing and size rules as user uploads (P4 §9).

## 10 Performance requirements

- Paste-to-visible-node ≤ 100 ms for up to 20 items.
- Unfurl p95 end-to-end ≤ 3 s for a responsive site; the queue sustains 10 unfurls/s per org.
- A 50-URL paste completes all unfurls within 20 s at default concurrency.

## 11 Tests to write (named)

- `packages/domain/test/capture.detect.test.ts` (full `DataTransfer` matrix).
- `packages/domain/test/ssrf.corpus.test.ts` + `net/dnsPin.test.ts` (rebinding, redirect chain).
- `apps/worker/test/unfurl.test.ts` (fixture server: OG tags, no title, slow, 404, oversized).
- `apps/api/test/extension.capture.test.ts` (token scopes, rate limit, board authz).
- `e2e/journeys/J02-paste-url.spec.ts`, `J03-drop-file.spec.ts` (extended).
- `e2e/security/ssrf-redirect.spec.ts` (redirect to 127.0.0.1 is blocked and messaged).
- `e2e/persistence/offline-paste.spec.ts`.

## 12 Acceptance criteria (checkable)

1. Pasting any of: URL, multiple URLs, image, text, HTML, file — produces the correct node type.
2. Website nodes fill in title/description/favicon within 3 s on a normal site.
3. Every hostile URL in the corpus is refused with the correct reason code.
4. Offline paste works and completes its unfurl after reconnect.
5. The extension endpoint creates a node with correct provenance and respects board permissions.
6. All capture actions are undoable as a single step per paste/drop.

## 13 Definition of Done

Acceptance criteria pass; `09_BACKEND.md` documents the unfurl job and cache; `15_SECURITY.md` §4
documents `safeFetch` as shipped; the OpenAPI document includes `/api/v1/capture`; tracker ticked.

## 14 What NOT to break

Offline-first (P3): no capture path may require the network to create a node. N1: a 50-node paste
must not stall the frame loop (create nodes in one transaction, not 50).

## 15 Documentation to update

`09_BACKEND.md`, `15_SECURITY.md`, `03_UX.md` §3 (final paste copy), OpenAPI spec, tracker.

---

# P7 — Projects & search

## 1 Objective

Ship multi-project organization (orgs → projects → boards), board management (create, rename,
duplicate, archive, delete, templates), global search across boards with Postgres FTS + `pg_trgm`,
and the `⌘/Ctrl+K` command palette that exposes every action in the product.

## 2 Context (what exists now)

P1 created `organizations`, `projects`, `boards` tables and a palette stub. P3–P6 fill boards with
content stored primarily in the CRDT; the Postgres `nodes`/`edges` projection does not exist yet —
this phase introduces a **local-only** search index path and defers the server projection to P8,
where the sync service owns it.

## 3 Existing architecture to respect

- `00_MASTER.md` §2 (Postgres FTS + pg_trgm now; pgvector later in P11/P13), §2 "Yjs as the
  document, Postgres as the projection".
- `09_BACKEND.md` §3 (projects/boards API), §6 (search), `08_DATA_MODEL.md` §5 (indexes).
- `03_UX.md` §8 (command palette rules), §9 (search UX).
- `18_TESTING.md` §11.3 (authz matrix — every new procedure must be added).

## 4 Files/modules affected

```text
packages/db/prisma/schema.prisma            projects, boards, board_members, search columns
apps/api/src/trpc/routers/{project.ts,board.ts,search.ts}
apps/api/src/search/{query.ts,rank.ts}
apps/web/src/projects/{ProjectList.tsx,ProjectSwitcher.tsx,BoardGrid.tsx,BoardCard.tsx}
apps/web/src/search/{GlobalSearch.tsx,useLocalSearch.ts,results.ts}
apps/web/src/palette/{CommandPalette.tsx,registry.ts,commands/*.ts}
packages/domain/src/search/{localIndex.ts,tokenize.ts,score.ts}
```

## 5 Exact requirements (numbered, testable)

1. Data model: `organizations 1—* projects 1—* boards`; `board` has `title`, `icon`, `archivedAt`,
   `templateOf?`, `lastOpenedAt`, `nodeCount`, `edgeCount` (denormalized counters updated by the
   projection in P8; until then updated on save from the client with a server-side sanity clamp).
2. Project operations: create, rename, set color/icon, archive, delete (soft, 30-day purge),
   member management (invite by email, role assignment, remove) — all audited.
3. Board operations: create (blank or from template), rename, duplicate (deep copy of doc + files),
   move to another project, archive, delete, export (P15 extends formats).
4. Templates: three built-ins shipped as JSON board exports — "Investigation starter" (person +
   accounts + evidence scaffold), "Repository review", "Blank with legend". Templates are ordinary
   boards flagged `isTemplate`, so users can save any board as a template.
5. Local search (works offline): an in-memory inverted index built from the open board's node
   `searchText()` (P4), incremental on doc changes, supporting prefix and fuzzy (Levenshtein ≤ 1
   for terms ≥ 4 chars) matching, returning ranked results in ≤ 30 ms for 5,000 nodes.
6. Global search (server): Postgres FTS over the projection with `websearch_to_tsquery`, plus
   `pg_trgm` similarity for names/titles; filters by project, board, node type, tag, date range,
   provenance source/tool; results are permission-filtered by the caller's memberships.
7. Search UX: a single input; results grouped by board; each result shows node type, title, a
   highlighted snippet (server-side `ts_headline` or client-side highlighting), board and project;
   `Enter` opens the board and animates the camera to the node with a 1.2 s highlight pulse.
8. Command palette: fuzzy over a registry of commands with `id`, `title`, `group`, `keywords`,
   `shortcut?`, `when(context)`, `run(context)`. Every user-facing action in the app registers here
   — a test asserts that each menu item has a corresponding command.
9. Palette modes: default (commands), `>` (commands only), `#` (tags), `@` (nodes on this board),
   `/` (boards and projects), `?` (help topics). Recent commands rank first (stored per user, local).
10. Keyboard: `⌘/Ctrl+K` palette, `⌘/Ctrl+P` board switcher, `/` focuses search, `Esc` closes;
    all with full arrow-key navigation and screen-reader announcements of the result count.
11. Board list surfaces: grid with thumbnails (generated by the worker from the board snapshot at
    most every 10 min), sorted by last opened; filters for archived and templates.
12. Permissions: viewers cannot create/rename/delete anything; every mutating control is disabled
    with a tooltip explaining why (N-requirement for honest UI, J20).

## 6 UX requirements

- Project switcher in the top-left: current project, search field, recent projects, "New project".
- Board grid cards: thumbnail, title, node/edge count, last opened, a menu (rename, duplicate,
  move, archive, export, delete). Destructive items are separated and require typed confirmation
  for delete ("type the board name").
- Empty states: no projects, no boards, no search results (with suggestions: check filters, try a
  different term), and archived-only view.
- Search feels instant: local results render in the same frame as typing; server results merge in
  with a subtle "N more from other boards" divider, never reordering what the user is already
  reading (append below).
- Palette shows the shortcut for each command and a "no results" state that offers the closest
  matches by edit distance.
- Loading: skeleton cards for the board grid; a shimmer-free spinner for server search after 300 ms.

## 7 Technical requirements

- Local index lives in the web app, rebuilt incrementally from Y.Doc observers; it must not block
  the main thread for more than 4 ms per update batch (chunk if larger).
- Server search columns: `search_tsv tsvector GENERATED ALWAYS AS (...) STORED` on the projection
  `nodes` table with a GIN index, plus a `gin_trgm_ops` index on `title`.
- All search input is parameterized; `websearch_to_tsquery` handles user syntax so raw tsquery
  parsing errors cannot occur.
- Palette command registry is typed; `when(context)` gates by permission, selection and view mode.
- Board duplication copies files by server-side object copy (no download/upload round-trip).

## 8 Edge cases

- Search terms with special characters, quotes, or 500 characters → handled by `websearch_to_tsquery`
  and a 200-char input cap.
- A board with 0 nodes has no thumbnail → deterministic placeholder derived from the board id.
- Deleting a project with 50 boards → a background job soft-deletes, the UI returns immediately and
  shows the operation in a "recently deleted" area for 30 days.
- Two users renaming the same board concurrently → last write wins on the metadata row (metadata is
  not CRDT), with a toast if the value changed underneath.
- Search while offline → local results only, with a clear "Searching this board only (offline)" note.
- A user removed from a project while viewing a board → the next call returns `FORBIDDEN`; the app
  shows a full-screen explanation and a link back to their projects (no silent blank page).

## 9 Security requirements

- Every search query is scoped by membership at the SQL level (a join on memberships), never by
  post-filtering in JS.
- Cross-org resources return 404, not 403, to avoid existence leaks (`18_TESTING.md` §11.3).
- Invitations are single-use, expire in 7 days, and are bound to the invited email.
- Board duplication re-checks permissions on the source and the destination project.
- Audit entries for: project/board create, rename, archive, delete, member add/remove/role change.

## 10 Performance requirements

- Local search: ≤ 30 ms p95 on a 5,000-node board; index build ≤ 400 ms on open.
- Server search p95 ≤ 300 ms at 1 M projected nodes (k6 scenario `search`).
- Palette opens in ≤ 80 ms with 500 registered commands.
- Board grid with 200 boards renders in ≤ 200 ms (virtualized above 60 cards).

## 11 Tests to write (named)

- `packages/domain/test/search.localIndex.test.ts` (prefix, fuzzy, ranking, incremental updates).
- `apps/api/test/search.query.test.ts` (filters, permission scoping, injection attempts).
- `apps/api/test/project.board.crud.test.ts` + authz matrix rows for every new procedure.
- `apps/web/src/palette/registry.test.ts` (every menu action has a command; `when` gating).
- `e2e/journeys/J15-global-search.spec.ts`, `J16-command-palette.spec.ts`, `J20-viewer-readonly.spec.ts`.
- `e2e/a11y/palette-keyboard.spec.ts`.

## 12 Acceptance criteria (checkable)

1. A user can create a project, three boards, rename, duplicate, archive and delete them, all
   audited and permission-checked.
2. Searching a term present in a node on another board finds it and jumps to it.
3. Local search returns results within 30 ms on a 5,000-node board while offline.
4. The palette can run every action available in menus, and the test proving that passes.
5. A viewer sees disabled controls with reasons and cannot mutate anything (server-verified).
6. Templates create working boards.

## 13 Definition of Done

Acceptance criteria pass; `09_BACKEND.md` §3/§6 match the implementation; the authz matrix covers
all new procedures; palette command list is documented; tracker ticked.

## 14 What NOT to break

Offline behavior (search must degrade, not fail), the shortcut reserved in P1, N1 (indexing must not
run on the frame path), and undo semantics for board-level operations (board metadata operations are
server-side and are _not_ in the CRDT undo stack — they get their own confirmation instead; state
this explicitly in the UI).

## 15 Documentation to update

`09_BACKEND.md`, `03_UX.md` §8–9, `08_DATA_MODEL.md` (search columns/indexes), tracker.

---

# P8 — Sync & collaboration

## 1 Objective

Introduce the Hocuspocus sync service, the Postgres projection of the CRDT, real-time presence,
comments, and the conflict/permission UX — turning the local-first app into a multi-user one without
weakening offline guarantees.

## 2 Context (what exists now)

P3 made the board a local Y.Doc with IndexedDB persistence and undo. P7 added projects, boards and
search (server search currently has an empty projection to read from). No WebSocket server exists;
`SYNC_URL` and `SYNC_SHARED_SECRET` are already in the env schema from P1.

## 3 Existing architecture to respect

- `00_MASTER.md` §2 (Hocuspocus 4, one room per board, Redis extension, projection in the same
  transaction as the snapshot; projection is idempotent and replayable).
- `09_BACKEND.md` §7 (sync service), `08_DATA_MODEL.md` §3 (projection tables and upsert rules).
- `19_DEPLOYMENT.md` §10.2 (`raven_sync_*` metrics — emit exactly those), §13 (memory budget).
- `03_UX.md` §11 (presence, comments, conflict copy), `18_TESTING.md` §7.6 (collab tests).

## 4 Files/modules affected

```text
apps/sync/src/{server.ts,auth.ts,persistence.ts,projection.ts,awareness.ts,eviction.ts,metrics.ts}
apps/api/src/trpc/routers/{boardToken.ts,comments.ts}
packages/db/prisma/schema.prisma        nodes, edges, board_snapshots, comments, presence_log
apps/web/src/data/{syncProvider.ts,presence.ts,connectionState.ts}
apps/web/src/collab/{PresenceLayer.tsx,Cursors.tsx,CommentThread.tsx,CommentPin.tsx}
packages/domain/src/projection/{projectUpdate.ts,diffDoc.ts}
scripts/reproject.ts
```

## 5 Exact requirements (numbered, testable)

1. `apps/sync` runs Hocuspocus with: `onAuthenticate` verifying a short-lived board token issued by
   the API (HMAC with `SYNC_SHARED_SECRET`, 5-minute TTL, containing `userId`, `boardId`, `role`),
   `onLoadDocument` restoring from `board_snapshots`, `onStoreDocument` writing snapshot + projection
   in one transaction, `onAwarenessUpdate` for presence, and the Redis extension for multi-pod fanout.
2. Read-only enforcement: a `viewer` token connects but every incoming update is rejected
   (Hocuspocus `beforeHandleMessage`), and the client also disables editing — server-side is the
   authority, client-side is the courtesy.
3. Projection: on each debounced store (2 s idle or 10 s max), compute the diff between the previous
   projected state vector and the new document, then upsert changed `nodes`/`edges` rows and delete
   removed ones. The projection is **idempotent** (re-running produces no changes) and **replayable**
   (`scripts/reproject.ts --board=<id>` rebuilds from the snapshot).
4. Projection failures never block the snapshot write: the snapshot is committed, the projection
   error is recorded (`raven_sync_projection_failures_total`) and retried with backoff; a board
   whose projection is stale is flagged in the admin view.
5. Client sync provider composes `y-indexeddb` (P3) with the WebSocket provider; IndexedDB always
   loads first so the board renders before the socket connects.
6. Sync status extends P3's indicator with server states: `Saved` (server-acked), `Saving…`,
   `Offline` (queued locally), `Reconnecting…`, `Read-only`, `Error`. Server ack within 2 s is
   required by N2 and is asserted in the e2e suite.
7. Reconnection: exponential backoff 1 s → 30 s with jitter, resume with the state vector (no full
   document resend), and a visible "Reconnecting… attempt N" after the second failure.
8. Presence: awareness carries `{ userId, name, color, cursor: {x,y}, selection: string[],
viewport: rect, activeNodeId? }` throttled to 20 Hz for cursors and 4 Hz for viewport.
9. Presence UI: cursors with name labels, colored selection outlines for remote selections, avatar
   stack in the top bar with "follow" mode (camera follows a chosen user until any local pan).
10. Comments: threads anchored to a node or to a canvas point; fields `id`, `boardId`, `anchor`,
    `body` (plain text + mentions), `authorId`, `createdAt`, `resolvedAt?`, `replies[]`. Stored in
    Postgres (not the CRDT) because they need server-side notification and permission queries;
    the doc holds only the anchor id so comment pins move with the node.
11. Mentions notify by email (rate-limited, digest after 3 in 10 minutes) and in an in-app inbox.
12. Room eviction: a room with zero connections for 60 s is snapshotted and unloaded; the memory
    gauge `raven_sync_doc_memory_bytes` is emitted per room.
13. Concurrency semantics documented and tested: concurrent node moves converge to one position
    (last writer per field), concurrent rich-text edits merge character-wise, delete-vs-edit yields
    deletion with a recoverable undo for the editing user, and edges to deleted nodes are pruned by
    the observer on both replicas.
14. Board tokens are refreshed silently before expiry; a revoked membership invalidates the next
    refresh and the socket is closed with code 4403 and a clear UI message.

## 6 UX requirements

- Presence is calm: cursors fade after 3 s of inactivity, labels only on movement or hover.
- Remote selection uses a 30 %-opacity outline in the user's color; it never obscures local selection.
- Conflict copy is honest and specific: "Alex moved this node while you were editing it. Your text
  was kept." Never "conflict detected".
- Read-only mode shows a persistent, unobtrusive banner with the reason and who can grant access.
- Comment pins are 20 px circles at the node corner; unresolved count badges on the board card.
- Comment composer supports `@` mentions with keyboard selection; `⌘/Ctrl+Enter` submits.
- Offline: the indicator explains what happens ("Your changes are saved on this device and will sync
  when you're back online") — never a bare icon.
- Follow mode shows a border tint and an obvious exit affordance.

## 7 Technical requirements

- The sync service imports `packages/domain` for schema validation of projected rows; it never
  imports UI or engine code.
- Snapshot storage: `board_snapshots(board_id, seq, binary bytea, state_vector bytea, created_at)`,
  keeping the last 10 plus daily snapshots for 30 days (`19_DEPLOYMENT.md` §11.1).
- Updates are appended to `board_updates` between snapshots only if snapshot debouncing exceeds
  10 s of continuous editing (bounded write amplification).
- Awareness is never persisted.
- Horizontal scale: Redis pub/sub extension; a pod restart must not drop edits (clients resend from
  their state vector).
- Graceful shutdown: on SIGTERM, stop accepting connections, flush all rooms, close sockets with
  code 1001 so clients reconnect elsewhere within 5 s.

## 8 Edge cases

- Client clock far in the future/past → irrelevant to CRDT correctness, but comment timestamps use
  server time only.
- A 5,000-node board opened by 10 users simultaneously → memory bound respected (one doc per room,
  not per user).
- Very large single update (paste of 50 nodes with images) → chunked by Yjs; the server enforces a
  10 MB per-message cap and closes the socket with a specific code on violation.
- Network flapping every 2 s → backoff prevents a reconnect storm; no duplicate nodes are created.
- Two tabs of the same user → both connect; awareness dedupes by `userId+tabId` in the avatar stack.
- Snapshot corrupt/undecodable on load → fall back to the previous snapshot, log, alert, and mark the
  board for reprojection.
- A user offline for 3 days reconnects with 400 local operations → merges cleanly; the test asserts
  no data loss and bounded merge time (≤ 3 s).

## 9 Security requirements

- Board tokens: HMAC-signed, 5-minute TTL, single board scope, role embedded; the sync service never
  queries permissions itself (single source: the API), and rejects unsigned/expired tokens with 4401.
- Message size and rate limits per connection (100 msg/s, 10 MB/msg); violations disconnect.
- Comment bodies are plain text, length-capped at 8,000 chars, sanitized on render, and mentions are
  resolved server-side against actual project members (no arbitrary email injection).
- Presence data exposes only display name and color — never emails.
- The projection writer uses a dedicated DB role with no DDL rights.

## 10 Performance requirements

- Broadcast latency p95 ≤ 250 ms within a region (k6 `sync-fanout`, 200 clients / 20 boards).
- Projection of a 5,000-node board ≤ 800 ms; incremental projection of a 50-node change ≤ 60 ms.
- Sync pod holds ≥ 120 open rooms within a 2 GB limit (`19_DEPLOYMENT.md` §13).
- Reconnect + resume for a 5,000-node board ≤ 1.5 s.

## 11 Tests to write (named)

- `apps/sync/test/auth.test.ts` (valid/expired/wrong-board/viewer tokens).
- `apps/sync/test/projection.idempotent.test.ts` and `projection.replay.test.ts`.
- `packages/domain/test/projection.diff.test.ts` (property: diff+apply == full projection).
- `apps/sync/test/eviction.test.ts` (memory released, snapshot written).
- `e2e/collab/two-tabs.spec.ts` (J8), `e2e/collab/concurrency-matrix.spec.ts` (5 cases from §5.13).
- `e2e/persistence/offline-then-sync.spec.ts` (J7, extended to the server).
- `e2e/collab/comments.spec.ts`, `e2e/collab/readonly.spec.ts` (J20 server-side).
- `load/sync-fanout.js` (k6).

## 12 Acceptance criteria (checkable)

1. Two browsers on one board converge within 1 s for every operation type.
2. Offline edits for 10 minutes sync without duplication or loss on reconnect.
3. The Postgres projection matches the CRDT for a 5,000-node board (`db:verify` reports zero drift),
   and `reproject` reproduces it exactly.
4. A viewer's update is rejected server-side even with a tampered client.
5. Killing a sync pod mid-edit loses nothing (clients resume on another pod).
6. Presence cursors, follow mode and comments work with keyboard only.
7. All `raven_sync_*` metrics from `19_DEPLOYMENT.md` §10.2 are emitted.

## 13 Definition of Done

Acceptance criteria pass; runbooks `runbooks/projection.md`, `runbooks/sync.md`,
`runbooks/sync-memory.md` written; alerts `SyncProjectionFailing`, `SyncBroadcastSlow`,
`SyncMemoryHigh` configured; `09_BACKEND.md` §7 updated; tracker ticked.

## 14 What NOT to break

N2 and the offline-first guarantee: the app must still fully work with the sync service down. Undo
must remain local-origin-scoped (N3) — a remote change must never be undone by a local `⌘Z`. Do not
move the source of truth to Postgres; the CRDT remains authoritative.

## 15 Documentation to update

`09_BACKEND.md`, `08_DATA_MODEL.md` (projection tables), `03_UX.md` §11, `19_DEPLOYMENT.md` §13
(measured memory), runbooks, tracker.
