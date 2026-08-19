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
(`apps/web/src/data/workspace/types.ts`) with both a local and a server implementation. Phases P8
(sync) and P9 (backend API & auth) are the phases that switch capabilities on; they do not become
prerequisites for anything shipping before them.

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

| Phase            | PRs               | Where it lives now                                                                                | Spec                               |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| P1 Foundation    | #2                | monorepo, tokens, app shell, CI, bench harness                                                    | `00_MASTER.md`, `19_DEPLOYMENT.md` |
| P2 Canvas engine | #3                | `packages/canvas-engine` (camera, spatial index, FSM, renderer)                                   | `05_CANVAS_ENGINE.md`              |
| P3 Document      | #4, #5            | `packages/domain` (board doc, patches, undo, autosave), `apps/web/src/data`                       | `08_DATA_MODEL.md`                 |
| P4 Node system   | #6, #7, #8        | `packages/domain/src/nodes`, `apps/web/src/nodes` (9 types, inspector, hosts)                     | `06_NODE_SYSTEM.md`                |
| P5 Edge system   | #11, #12, #17     | edge taxonomy, 4 routing modes + cache, ports, selection, relationship UI — **part 4 open below** | `07_EDGE_SYSTEM.md`                |
| Local-first      | #9, #10, #13, #14 | `APP_MODE=local`, `WorkspaceRepository`, local persistence, first-run seed                        | `docs/adr/ADR-001-local-first.md`  |
| L4.1 Transforms  | #15               | `packages/transforms` (manifests, registries, router, modes, scores, planner, catalogue)          | `21_TRANSFORM_SYSTEM.md`           |
| Layer-2 docs     | #16               | `22_ECOSYSTEM_AUDIT.md`, `23_COMPETITOR_MATRIX.md`, `24_UNIFIED_QUERY.md` (design only)           | those documents                    |
| Agent memory     | #18               | `AGENTS.md`, `.mcp.json`                                                                          | —                                  |

Open phases in this file: **P5 part 4**, **P6**, **P7**, **P8**, **P17**, **L4.2–L4.7**. P9–P16 have
no prompt yet; write one in this format when their turn comes.

---

# P5 part 4 — Edge system, remaining scope

Parts 1–3 shipped (see the ledger). Only this is left; everything else in `07_EDGE_SYSTEM.md` is
implemented and must not be rewritten.

1. **Waypoints** — double-click an edge inserts a waypoint, drag moves it, right-click deletes it;
   `orthogonal`/`smart` paths pass through waypoints in order; one undo step per operation;
   a waypoint dropped inside a node is legal but flagged in the inspector.
2. **Routing in a worker** — move routing into `packages/canvas-engine/src/edges/router.worker.ts`
   behind the existing cached `EdgePath` seam, transferable `ArrayBuffer`s, batched per frame,
   at most 400 edges per frame with visible edges first. Main-thread routing stays as the fallback
   when workers are unavailable. Required only when a measured scene misses the frame budget —
   record the measurement in `16_PERFORMANCE.md` either way.
3. **Animated flow** on `derived_from` / inferred edges, disabled under `prefers-reduced-motion`.
4. **Edge bundling** for dense parallel runs, off by default, with a density control.

Budgets unchanged: 10,000 curved edges repaint ≤ 6 ms, `route-smart-2000-edges` ≤ 900 ms,
p95 ≤ 16.6 ms while dragging 200 nodes with 1,000 edges, routing cache hit ratio ≥ 90 %.
Tests: waypoint unit tests in `packages/canvas-engine/test`, the routing property suite unchanged,
`e2e/visual/edges.spec.ts` extended with a waypointed edge. Update `07_EDGE_SYSTEM.md` §15.6a,
`packages/canvas-engine/README.md` (worker protocol) and this ledger.

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
need no runtime and no UI, while L4.4 onward depend on the integration runtime (P10) and the canvas
UI. Nothing here changes a phase that is already done.

| Phase    | Content                                                                                                                                                                                           | Depends on          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **L4.1** | Ecosystem audit, provider catalogue, transform catalogue, this spec, `packages/transforms` foundation: manifests, registries, capability router, modes, scoring, expand planner, seeded catalogue | —                   |
| L4.2     | Transform SDK surface for third parties (`initialize/validateInput/execute/stream/normalize/healthCheck`) and the conformance test harness                                                        | L4.1, 17_PLUGIN_SDK |
| L4.3     | Run history, replay, run comparison and the result cache with TTL and age labelling                                                                                                               | L4.1, P3            |
| L4.4     | Execution integration: engines become Runner jobs, streaming partial results, cancellation, budgets enforced at run time                                                                          | P10                 |
| L4.5     | Canvas UX: contextual menu, hover chips, Expand with preview, result clusters, density control, data-flow disclosure                                                                              | L4.4, P4/P5         |
| L4.6     | Provider vault, provider settings UI, ecosystem health check (stale `lastVerified`, dead endpoints, deprecations)                                                                                 | L4.4, P9            |
| L4.7     | Agent-driven transform planning under budgets, plan explanation, smart chaining                                                                                                                   | L4.4, 14_AI_AGENT   |

**L4.1 shipped** (PR #15): see the ledger. Acceptance criteria for it are now permanent invariants
of `packages/transforms`, asserted by `test/catalog.contract.test.ts` — registry validation clean,
every `core` transform reachable with zero credentials, no network engine in strict-local mode,
every fallback chain terminal, no future `lastVerified`, every plan states its exclusions, and code
cannot drift from `docs/ecosystem/*.md`.

## What NOT to break

The transform layer must not become a second integration framework: execution, parsing, entity
extraction and the `ImportProposal` write path stay in `10_INTEGRATIONS.md`. Transforms must never
name providers directly (rule T1), and no result may reach the graph without a proposal (N4).
