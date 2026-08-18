# Raven — 01 PRODUCT SPECIFICATION

## Scope

This document defines _what_ Raven is, _who_ it is for, and _which_ capabilities ship in which
phase. It refines `00_MASTER.md` and never re-decides the stack, the layer map or the phase order
frozen there. It contains: vision, three target users with jobs-to-be-done, anti-personas, the core
loop, a full mapping of the client's 56 roadmap sections to the spec documents that implement them,
22+ self-proposed features, success metrics and SLOs, non-goals, packaging notes, and legal/ethical
positioning. Interaction detail lives in `03_UX.md`; data shapes in `08_DATA_MODEL.md`.

---

## 1. Vision

### 1.1 One paragraph

Raven is a desktop-class web workspace where a researcher turns scattered evidence into a defensible
answer. Evidence enters in one keystroke (`Ctrl+V`), becomes a typed entity with provenance, is
linked into a graph, is enriched by sandboxed open-source tooling (GitHub, Sherlock, SpiderFoot) and
by an AI layer that may only _propose_, and leaves as a report where every claim carries a numbered
citation back to a captured source. The canvas is not the product; the canvas is the fastest known
interface for the product, which is a provenance-carrying knowledge graph.

### 1.2 The problem, stated concretely

An analyst working a target today runs a browser with 40 tabs, a folder of screenshots, a Markdown
scratch file, one or two CLI tools whose JSON output nobody re-reads, and a spreadsheet of
usernames. Four failures follow, and Raven is designed against exactly these four:

| Failure                    | Observable symptom                                                    | Raven answer                                                                                       |
| -------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Capture friction           | evidence is not saved because saving costs 20 seconds and breaks flow | paste is the front door; capture ≤ 400 ms, structure later (`03_UX.md` §7)                         |
| Lost provenance            | three weeks later nobody can say where a claim came from              | every node carries `source`, `tool`, `run_id`, `observed_at`, `confidence` (`08_DATA_MODEL.md` §3) |
| Tool output rot            | a 4 MB SpiderFoot JSON is never read past line 50                     | manifest-driven extraction into typed entities + Import Proposal diff (`10_INTEGRATIONS.md` §6)    |
| Unreproducible conclusions | the report cannot be defended or re-run                               | citation numbering, chain-of-custody export, investigation replay (§6.4, §6.10)                    |

### 1.3 Product thesis

Three claims, each falsifiable, each with an owner document:

1. **A typed graph beats a folder** once evidence count exceeds ~50 items, because the questions an
   analyst asks are relational ("what else touches this handle?"), not hierarchical.
2. **Provenance is a feature, not compliance overhead.** It is what allows aggressive automation:
   tools and AI may generate a lot, because the user can always see origin and confidence and
   reject in one click (N4 in `00_MASTER.md` §4).
3. **Perceived quality is latency plus reversibility.** 60 fps at 5,000 nodes (N1) and universal
   undo (N3) do more for trust than any visual treatment.

### 1.4 Positioning sentence

> For analysts who must _show their work_: an infinite canvas over a provenance-first entity graph,
> with sandboxed OSINT tooling and AI that can only suggest.

Comparison is deliberately limited to capability classes, not marketing claims: whiteboards
(Milanote-class) capture but do not type or enrich; note graphs (Obsidian-class) type loosely but
have no execution or provenance layer; link-analysis suites type strictly but are heavyweight,
closed and do not accept casual capture. Raven occupies the intersection: casual capture, strict
typing, sandboxed execution, self-hostable.

---

## 2. Target users

Three users, in priority order. P1 drives defaults; P2 drives collaboration, audit and RBAC; P3
drives templates, tables and export. Any feature that serves none of the three is a non-goal.

### 2.1 P1 — Independent OSINT researcher ("Mara")

Solo or two-person practice; investigative journalism, fraud verification, missing-person support,
paid due-diligence gigs. Self-hosts because client data must not leave her machine. Windows/macOS
laptop, 16 GB RAM, 1440p or 1080p screen, occasionally on tethered mobile connection. Lives in the
browser and a terminal, comfortable with CLI tools, allergic to SaaS that hides data.

Jobs-to-be-done:

| #    | Job (when… I want… so that…)                                                                             | Success signal                                        | Where specified                     |
| ---- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------- |
| J1.1 | When I find a lead mid-browse, I want it on the board in one keystroke so that I never lose it           | paste → node ≤ 400 ms, no dialog                      | `03_UX.md` §7                       |
| J1.2 | When I have 8 handles, I want to test them across platforms so that I find the same person elsewhere     | Sherlock run → username/account nodes with confidence | `13_SHERLOCK.md`                    |
| J1.3 | When leads multiply, I want to see the shape of the case so that I can spot the hub                      | force/graph view + clustering                         | `14_AI_AGENT.md` §7, `03_UX.md` §16 |
| J1.4 | When I deliver, I want a report where every claim cites captured evidence so that the client can verify  | report export with numbered citations                 | §6.22, `15_SECURITY.md` §7          |
| J1.5 | When I work on a plane or a bad hotel line, I want full function offline so that travel is not dead time | offline-first, queued capture                         | §6.12, `00_MASTER.md` §2            |
| J1.6 | When a claim is challenged, I want to show exactly how I got there so that my work survives scrutiny     | replay + chain-of-custody export                      | §6.4, §6.10                         |

Anti-requirements for Mara: no mandatory cloud account, no telemetry that leaves the host by
default, no feature that requires inviting a teammate.

### 2.2 P2 — Corporate threat-intel analyst ("Devon")

Member of a 4–12 person team inside a bank, SaaS company or MSSP. Works tickets and campaigns:
phishing infrastructure, brand abuse, insider risk, third-party incident triage. Deliverables go to
SOC leads and legal. Cares about: shared boards, who-changed-what, watchlists, retention policy,
SSO, and never being the person who pasted a client identifier into a third-party service.

Jobs-to-be-done:

| #    | Job                                                                                                        | Success signal                            | Where specified               |
| ---- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------- |
| J2.1 | When a campaign reappears, I want to know if we have seen this indicator before so that I reuse prior work | cross-project reference index (§6.19)     | `07_EDGE_SYSTEM.md` §9, §6.19 |
| J2.2 | When I hand off at shift end, I want a colleague to continue without a call                                | realtime board + presence + comments      | `00_MASTER.md` P8             |
| J2.3 | When infrastructure changes, I want to be told so that I do not re-run scans manually                      | watchlists with change alerts (§6.9)      | §6.9, `09_BACKEND.md` §8      |
| J2.4 | When legal asks, I want an immutable record of who added what and when                                     | audit log + node history diffing          | `15_SECURITY.md` §8, §6.8     |
| J2.5 | When I share externally, I want sensitive fields removed without maintaining a second board                | redaction mode (§6.11)                    | §6.11                         |
| J2.6 | When we compare theories, I want to structure the disagreement                                             | hypothesis nodes + ACH view (§6.20–§6.21) | §6.20, §6.21                  |

### 2.3 P3 — Technical due-diligence / research generalist ("Ines")

Consultant, VC associate, security architect or academic. Evaluates codebases, vendors, ecosystems
and literature. Less identity work, far more repository and document work. Wants structured
comparison and a deck-ready output, not a graph aesthetic.

Jobs-to-be-done:

| #    | Job                                                                                  | Success signal                     | Where specified        |
| ---- | ------------------------------------------------------------------------------------ | ---------------------------------- | ---------------------- |
| J3.1 | When I assess a repo, I want maintenance signals without cloning it                  | GitHub repo node + analysis agent  | `11_GITHUB.md`         |
| J3.2 | When I compare 12 candidates, I want a table view over the same graph                | table view with typed columns      | `00_MASTER.md` P14     |
| J3.3 | When I start a new engagement, I want a pre-built structure                          | canvas templates (§6.13)           | §6.13                  |
| J3.4 | When I present findings, I want to walk stakeholders through the board               | presentation mode                  | `03_UX.md` §17         |
| J3.5 | When I collect 60 PDFs, I want them summarized and linked, with page-anchored quotes | file nodes + AI summarize proposal | `14_AI_AGENT.md` §5    |
| J3.6 | When two sources conflict, I want the conflict visible instead of averaged away      | contradicting edges (§6.20)        | `07_EDGE_SYSTEM.md` §4 |

### 2.4 Shared platform expectations

All three: dark UI by default; keyboard-first; self-host possible; export owns your data;
"nothing silently changes data" (`00_MASTER.md` §1). Divergences that the product must absorb
without forking the UI: Mara needs single-player speed, Devon needs governance, Ines needs
structured output. The resolution is that governance features are _off by default and additive_
(project setting `governance_mode`, see `15_SECURITY.md` §3) and structured output is a _view_, not
a separate data model.

### 2.5 Anti-personas

Explicitly not designed for. Each line names the feature pressure we refuse.

| Anti-persona             | What they would ask for                                                  | Why refused                                                                                              |
| ------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Stalker / harasser       | untargeted people-search, "find home address", scraping private accounts | acceptable-use enforcement (§10); no unauthenticated mass-personal-data connectors                       |
| Growth/lead-gen scraper  | bulk email harvesting, CSV of 100k contacts, CAPTCHA solving             | rate/volume design targets a single analyst; no anti-bot evasion                                         |
| Casual mood-boarder      | fonts, stickers, freehand drawing, presentation aesthetics as the point  | typed graph overhead is a cost they never repay; whiteboards serve them better                           |
| Enterprise SIEM buyer    | log ingestion at MB/s, alert correlation, detections                     | Raven is an investigation workspace, not a streaming pipeline (§8)                                       |
| Offensive operator       | exploitation, credential stuffing, unauthorized active scanning          | runner egress allowlist + acceptable use; tool manifests declare intrusiveness (`10_INTEGRATIONS.md` §4) |
| "Autonomous agent" buyer | let the AI run the whole investigation unattended                        | N4 forbids unattended writes; proposals require a human accept                                           |

---

## 3. The core loop

```text
        ┌──────────┐   ┌────────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
   ──▶  │ CAPTURE  │──▶│ STRUCTURE  │──▶│  ENRICH  │──▶│  REASON  │──▶│  REPORT  │──▶ deliverable
        └────┬─────┘   └──────┬─────┘   └─────┬────┘   └─────┬────┘   └────┬─────┘
             └────────────────┴───────────────┴──────────────┴─────────────┘
                        every stage can feed any earlier stage (loop, not funnel)
```

The loop is the product's spine: each stage has an owning surface, a target time budget, and a
failure mode we design against.

### 3.1 Capture

Surface: canvas paste, drag&drop, quick-add (`Ctrl+Shift+A`), triage inbox lane (§6.14), browser
extension hook (P6). Budget: intent → node visible ≤ 400 ms p95; unfurl completes asynchronously
≤ 3 s p95 and never blocks the node.
Rules: capture never asks a question it can infer; ambiguity is resolved _after_ creation via a
transient disambiguation chip (`03_UX.md` §7.4). Nothing is dropped: unresolvable clipboard content
becomes a text node with the raw payload attached.
Failure mode designed against: user hesitates because they must choose a type first. Therefore type
inference is automatic and always correctable.

### 3.2 Structure

Surface: edges, groups, tags, entity merge/split (§6.7), auto-layout suite (P14).
Budget: connect two nodes in ≤ 2 gestures; retype an edge in ≤ 2 keystrokes.
Rules: structure is offered, never demanded (`00_MASTER.md` §3.3). Suggested structure arrives as
ghost edges the user accepts. A board with zero edges must remain fully usable.

### 3.3 Enrich

Surface: node action menu → integration run; run history panel; Import Proposal diff.
Budget: run start ≤ 1 s to queued state with visible progress; every run cancellable; hard timeout
per manifest.
Rules: all execution in the sandboxed runner (N5); every produced node carries `run_id` and
`confidence`; import is a reviewable diff (added / merged / conflicting), never a silent dump.

### 3.4 Reason

Surface: views (graph/timeline/table/list/map), search, hypothesis nodes + ACH view (§6.20–§6.21),
AI proposals (summarize, link, dedupe, cluster).
Budget: any view switch ≤ 250 ms on a 5,000-node board; search first results ≤ 150 ms local.
Rules: AI output is a Proposal with rationale and cited node IDs; a proposal the user cannot explain
is a bug (`14_AI_AGENT.md` §4).

### 3.5 Report

Surface: report builder (§6.22), export (PDF/Markdown/JSON/archive), presentation mode, redaction
mode, chain-of-custody bundle.
Budget: draft report from a 300-node board ≤ 10 s.
Rules: every assertion in an exported report resolves to at least one node with a source; claims
without provenance are marked `[unsourced]` in the draft rather than silently emitted.

### 3.6 Loop instrumentation

Each stage emits one analytics event with a stage id (`capture.node_created`,
`structure.edge_created`, `enrich.run_completed`, `reason.view_switched`, `report.exported`), local
by default, so §7 metrics are computable without shipping content anywhere (`09_BACKEND.md` §9).

---

## 4. Feature inventory — client roadmap mapping

The client roadmap ("Дорожная карта для ии разроботчика сайта.md") contains 56 numbered sections.
Every section is mapped below to the spec document + section that specifies it and to the phase from
`00_MASTER.md` §7 that ships it. Sections 1–2, 40–56 are process/meta requirements addressed by the
spec set itself and its gates; they are still listed so nothing is unaccounted for.

| #   | Roadmap requirement (short English)                                                                                                          | Specified in                                                                               | Phase                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------- |
| 1   | Architecture-first: derive subsystems, entities, state, sync, undo, DnD, edges, plugins, perf, import/export before code                     | `00_MASTER.md` §2, §5; `02_ARCHITECTURE.md`                                                | P0                                  |
| 2   | Screenshot is reference only; do not copy its design                                                                                         | `04_DESIGN_SYSTEM.md` §1 (own visual system, no derivation)                                | P1                                  |
| 3   | Dark Premium Intelligence visual direction with a real design system                                                                         | `04_DESIGN_SYSTEM.md` §2–§9                                                                | P1                                  |
| 4   | Infinite canvas: pan, zoom, multi/box select, drag, snap, align, group, auto-layout, minimap, grid, lock, hide, layers, viewport persistence | `05_CANVAS_ENGINE.md` §3–§9; `03_UX.md` §5–§6                                              | P2, P14 (auto-layout), P15 (groups) |
| 5   | Node system: website, text, image, file, link, note/evidence, person/username, repository                                                    | `06_NODE_SYSTEM.md` §3                                                                     | P4                                  |
| 6   | `Ctrl+V` as a headline feature across all clipboard shapes                                                                                   | `03_UX.md` §7; `06_NODE_SYSTEM.md` §6                                                      | P6                                  |
| 7   | Connections: typed, smooth, readable, interactive, stable, auto-routing                                                                      | `07_EDGE_SYSTEM.md` §2–§6                                                                  | P5                                  |
| 8   | Smart auto-layout (hierarchical, force, radial, grid, cluster)                                                                               | `05_CANVAS_ENGINE.md` §10; `14_AI_AGENT.md` §7                                             | P14                                 |
| 9   | Full GitHub support: repo metadata, README, releases, contributors                                                                           | `11_GITHUB.md` §2–§5                                                                       | P10                                 |
| 10  | Open-source integrations framework                                                                                                           | `10_INTEGRATIONS.md` §2–§7                                                                 | P9                                  |
| 11  | SpiderFoot integration (scan orchestration, entity/correlation mapping)                                                                      | `12_SPIDERFOOT.md`                                                                         | P12                                 |
| 12  | Sherlock integration (username enumeration)                                                                                                  | `13_SHERLOCK.md`                                                                           | P11                                 |
| 13  | Required integration architecture: adapter → execution → parser → extractor → mappers → proposal                                             | `10_INTEGRATIONS.md` §5–§6                                                                 | P9                                  |
| 14  | Automatic GitHub code research agent                                                                                                         | `11_GITHUB.md` §6–§8                                                                       | P10                                 |
| 15  | Extensibility as a first-class property                                                                                                      | `17_PLUGIN_SDK.md` §2–§6                                                                   | P9 (SDK types), P16 (public)        |
| 16  | AI research assistant                                                                                                                        | `14_AI_AGENT.md`                                                                           | P13                                 |
| 17  | Search (global, filtered, fuzzy, semantic)                                                                                                   | `09_BACKEND.md` §6; `03_UX.md` §9                                                          | P7 (FTS), P13 (semantic)            |
| 18  | Copy/paste of nodes and subgraphs, cross-board                                                                                               | `03_UX.md` §7.9; `06_NODE_SYSTEM.md` §7                                                    | P6                                  |
| 19  | Groups / clusters                                                                                                                            | `05_CANVAS_ENGINE.md` §9; `03_UX.md` §6.8                                                  | P15                                 |
| 20  | Multi-project system                                                                                                                         | `08_DATA_MODEL.md` §4; `03_UX.md` §3                                                       | P7                                  |
| 21  | Persistence / saving                                                                                                                         | `08_DATA_MODEL.md` §2; `00_MASTER.md` §2                                                   | P3                                  |
| 22  | Offline-first                                                                                                                                | `08_DATA_MODEL.md` §2.4 (`y-indexeddb`, OPFS)                                              | P3                                  |
| 23  | Performance at thousands of objects                                                                                                          | `16_PERFORMANCE.md`; `05_CANVAS_ENGINE.md` §2                                              | P2, P16                             |
| 24  | Animations: purposeful, non-blocking                                                                                                         | `04_DESIGN_SYSTEM.md` §8; `03_UX.md` §13                                                   | P1                                  |
| 25  | Responsive behavior                                                                                                                          | `03_UX.md` §18 (distinct tablet/mobile experience)                                         | P16                                 |
| 26  | Accessibility                                                                                                                                | `03_UX.md` §19; N6                                                                         | every phase                         |
| 27  | Data model                                                                                                                                   | `08_DATA_MODEL.md` §3                                                                      | P3–P5                               |
| 28  | Security                                                                                                                                     | `15_SECURITY.md`                                                                           | every phase                         |
| 29  | Import / export                                                                                                                              | `08_DATA_MODEL.md` §7 (JSON v1, lossless, N9)                                              | P15                                 |
| 30  | Additional features invented by the designer                                                                                                 | §6 of this document (24 features)                                                          | P4–P16                              |
| 31  | Presentation mode                                                                                                                            | `03_UX.md` §17                                                                             | P15                                 |
| 32  | Visual graph modes                                                                                                                           | `00_MASTER.md` P14; `03_UX.md` §16                                                         | P14                                 |
| 33  | Plugin SDK                                                                                                                                   | `17_PLUGIN_SDK.md`                                                                         | P9/P16                              |
| 34  | Technology stack                                                                                                                             | `00_MASTER.md` §2 (frozen)                                                                 | P0                                  |
| 35  | Not a monolith: modular services/packages                                                                                                    | `00_MASTER.md` §6; `02_ARCHITECTURE.md` §3                                                 | P1                                  |
| 36  | UX behavior rules (predictability, feedback, reversibility)                                                                                  | `03_UX.md` §2, §12–§14                                                                     | every phase                         |
| 37  | Error handling                                                                                                                               | `03_UX.md` §12 (what/why/what-to-do copy)                                                  | every phase                         |
| 38  | Design system depth                                                                                                                          | `04_DESIGN_SYSTEM.md`                                                                      | P1                                  |
| 39  | UX priority over feature count                                                                                                               | this doc §3, §7 metrics; gate §8.2                                                         | every phase                         |
| 40  | Independent research of options before deciding                                                                                              | `00_MASTER.md` §2 "Why this architecture" + rejected alternatives in `05_CANVAS_ENGINE.md` | P0                                  |
| 41  | Project file system / monorepo layout                                                                                                        | `00_MASTER.md` §6                                                                          | P1                                  |
| 42  | Master document as single source of truth                                                                                                    | `00_MASTER.md`                                                                             | P0                                  |
| 43  | No real TODOs                                                                                                                                | N10; gate §8                                                                               | every phase                         |
| 44  | Implementation roadmap                                                                                                                       | `20_ROADMAP.md`                                                                            | P0                                  |
| 45  | Each phase is a self-contained prompt                                                                                                        | `20_ROADMAP.md` §per-phase prompts                                                         | P0                                  |
| 46  | Coding AI must not destroy existing work                                                                                                     | `00_MASTER.md` §10.3; gate §8 PR statement                                                 | every phase                         |
| 47  | Quality gate                                                                                                                                 | `00_MASTER.md` §8                                                                          | every phase                         |
| 48  | "Do not invent bugs" checklist                                                                                                               | `00_MASTER.md` §10.7; `18_TESTING.md` §9                                                   | every phase                         |
| 49  | Visual quality bar                                                                                                                           | `04_DESIGN_SYSTEM.md` §10; Playwright visual snapshots                                     | every phase                         |
| 50  | Final result definition (production-ready app)                                                                                               | `00_MASTER.md` §7 P16 + `19_DEPLOYMENT.md`                                                 | P16                                 |
| 51  | Special instruction: act as full senior team                                                                                                 | spec set authorship; `02_ARCHITECTURE.md` review notes                                     | P0                                  |
| 52  | "Perfect design" rule                                                                                                                        | `04_DESIGN_SYSTEM.md` §10 acceptance criteria                                              | every phase                         |
| 53  | "Production ready" rule                                                                                                                      | `19_DEPLOYMENT.md`; `18_TESTING.md`                                                        | P16                                 |
| 54  | Mandatory self-check                                                                                                                         | `00_MASTER.md` §8 evidence-in-PR requirement                                               | every phase                         |
| 55  | Final output format (spec file set)                                                                                                          | `00_MASTER.md` §9 index                                                                    | P0                                  |
| 56  | Main point: production-grade, no guessing                                                                                                    | N10 + gate §8                                                                              | every phase                         |

### 4.1 Coverage assertion

No roadmap section is unassigned. Two sections are intentionally _reinterpreted_ rather than taken
literally, and the reinterpretation is stated here so it is not mistaken for an omission:

- §25 "Responsive": literal responsiveness (a shrunken desktop canvas) is rejected. Mobile gets a
  reading + capture experience with a different IA (`03_UX.md` §18). Justification: a 6-inch
  multi-select drag interaction cannot be made good, while mobile capture is genuinely valuable.
- §16 "AI research assistant": the assistant never mutates the graph; it emits proposals (N4).
  Justification: provenance-first is non-negotiable and unattended writes destroy it.

---

## 5. Feature inventory — capability list

Grouped by subsystem, with the phase that ships each. This is the checklist a phase PR is graded
against; it is deliberately flat and testable.

### 5.1 Canvas (P2, P14, P15)

Pan (space-drag, middle-drag, trackpad two-finger, edge auto-pan during drag), zoom (wheel+ctrl,
pinch, `Ctrl+0/1/2`, zoom-to-selection, zoom-to-fit), infinite scroll space bounded only by
float precision guard at ±10^6 world units, marquee select, additive/subtractive select, drag with
snapping (node-to-node edges, centers, spacing, grid), alignment + distribution, groups with
collapse, layers with z-order operations, per-node lock and hide, minimap with viewport rect and
drag-to-navigate, grid rendering with optional snapping, viewport persisted per board per user,
LOD rendering below `zoom < 0.55`, off-viewport nodes unmounted, auto-layout: hierarchical, force,
radial, grid, cluster-aware.

### 5.2 Nodes (P4)

Types: `website`, `link`, `text`, `image`, `file`, `note`, `evidence`, `person`, `username`,
`account`, `email`, `domain`, `ip`, `repository`, `group`, `hypothesis`, `query`, `tool_run`.
Per-type: schema, inspector editor, LOD glyph, default size, resize rules, badges, quick actions.
Common: title, tags, color accent, pin, lock, hide, comments, provenance block, history.

### 5.3 Edges (P5)

Typed relations (`relates_to`, `mentions`, `owns`, `same_as`, `derived_from`, `contradicts`,
`supports`, `member_of`, `resolves_to`, `communicates_with`), directionality, labels, routing modes
(straight / curved / orthogonal / smart with obstacle avoidance in a worker), midpoint handles,
reconnect by dragging an endpoint, edge confidence (§6.6), multi-edge fanning, edge selection and
inspector.

### 5.4 Capture (P6)

Paste pipeline for 11 clipboard shapes, drag&drop from desktop and between panels, folder drop,
quick-add palette, unfurl service with SSRF guard (N7), screenshot paste, offline capture queue
(§6.12), triage inbox lane (§6.14), browser-extension hook endpoint.

### 5.5 Projects, search, palette (P7)

Projects → boards → nodes hierarchy, project rail, recent boards, board templates (§6.13), global
search (FTS + trigram fuzzy), saved searches / smart collections (§6.5), command palette with modes
(§`03_UX.md` §9), cross-project reference index (§6.19).

### 5.6 Sync & collaboration (P8)

Hocuspocus rooms, projection to Postgres, presence cursors and selections, per-node comments with
mentions and resolve, conflict surface (`03_UX.md` §12.7), sync status indicator, node history
diffing (§6.8), audit log.

### 5.7 Integrations (P9–P12)

Manifest schema + registry, runner sandbox, run lifecycle UI (queued/running/partial/failed/done),
Import Proposal diff, run history with re-run and diff-against-previous, GitHub (repo, README,
releases, contributors, analysis agent), Sherlock (username enumeration → `account` nodes),
SpiderFoot (scan orchestration → entities + correlations, behind a pinned digest and adapter risk
controls per `12_SPIDERFOOT.md` §2).

### 5.8 AI layer (P13)

Summarize node/selection/board, explain a subgraph, suggest links, detect duplicates, cluster and
name clusters, draft investigation summary, extract entities from pasted text, all as Proposals with
rationale + cited node IDs + cost estimate; per-project budget cap and provider abstraction.

### 5.9 Views, presentation, export (P14–P15)

Graph (force), timeline (by `observed_at`), table (typed columns, sort/filter/edit), list (triage),
map (geo-bearing entities only), presentation mode with ordered scenes, report builder (§6.22),
export: JSON v1, Markdown bundle, PDF report, ZIP archive with blobs, chain-of-custody bundle
(§6.10), redaction mode (§6.11).

---

## 6. Self-proposed features (not requested by the client)

24 features. Each: problem, UX justification, cost/complexity, phase. Cost scale: **S** ≤ 3 dev-days,
**M** 4–10, **L** 11–25, **XL** > 25, assuming one competent implementer plus review, on top of the
subsystem the feature depends on. All of these obey N4 (proposal-gated) and N8 (undoable) where they
mutate data.

### 6.1 Evidence confidence scoring

**Problem.** Not all evidence is equal: a self-reported bio, a WHOIS record and a manual
verification cannot carry the same weight, yet a graph flattens them into identical cards.
**Solution.** Every node and edge carries `confidence: 0..1` plus `confidence_basis:
'manual' | 'tool' | 'ai' | 'inferred'`. Tools set an initial value from the manifest
(`confidence_default` per output kind); the user can override with a 5-step control
(`suspected 0.2 / possible 0.4 / probable 0.6 / likely 0.8 / confirmed 1.0`). Rendering: a 3 px
left rail on the card with token-driven opacity ramp, plus an explicit chip when < 0.4.
**UX justification.** Makes the analyst's own uncertainty visible and reduces the "everything on the
board looks like a fact" failure that produces bad reports. Also gives the report builder a rule:
claims below 0.4 are emitted as "unconfirmed".
**Cost.** M (schema + inspector control + rendering + report rule).
**Phase.** P4 (schema + control), report integration P15.

### 6.2 Source attribution chain

**Problem.** A node created by a tool from another node from a pasted URL has a three-step lineage
that is invisible; challenged findings die here.
**Solution.** `derived_from` edges are auto-created by every importer and by AI extraction, forming
a DAG. Inspector shows a "Provenance" section rendering the chain upward to the root capture, each
step with tool, run id, timestamp and a link to the raw payload blob. Keyboard `Alt+P` opens the
chain view; the chain is also serialized into the chain-of-custody export (§6.10).
**UX justification.** One click from "claim" to "why", which is the single most common review
question. It also makes deletion honest: deleting a root offers to keep or cascade derived nodes.
**Cost.** M (DAG queries via recursive CTE + panel; importers already record `run_id`).
**Phase.** P9 (chain from tool runs), extended in P13 for AI-derived nodes.

### 6.3 Duplicate detection

**Problem.** The same domain, handle or article enters a board 5 times from different routes; the
graph silently double-counts and hubs look bigger than they are.
**Solution.** Deterministic pass on write (normalized key: lowercased domain with `www.` stripped,
canonicalized URL without tracking params, handle lowercased per-platform rules, file SHA-256) plus
a fuzzy pass (trigram similarity ≥ 0.82 on title, pgvector cosine ≥ 0.9 in P13). Matches surface as
a non-blocking "Possible duplicate" chip on the newer node with actions **Merge**, **Keep both**,
**Not a duplicate** (recorded as a negative pair so it never re-asks).
**UX justification.** Blocking the paste would violate "capture is frictionless"; a chip preserves
speed while making the cleanup one keystroke.
**Cost.** M deterministic + S fuzzy on top of existing indexes.
**Phase.** P6 (deterministic), P13 (semantic).

### 6.4 Investigation replay / time-travel

**Problem.** Analysts cannot reconstruct _how_ an investigation developed, which matters for review,
for training, and for spotting when a wrong assumption entered.
**Solution.** Hocuspocus already stores periodic Yjs snapshots; add a monotonically increasing
`board_version` with named checkpoints. A timeline scrubber (opened with `Ctrl+Shift+H`) replays the
board read-only, node creations fading in at their `created_at`, with a speed control and
"jump to next 10 changes". Checkpoints can be **branched** into a new board rather than restored
in place, so replay can never destroy current state.
**UX justification.** Read-only-by-default removes the fear that made undo history unusable in other
tools; branching converts "what if we were wrong at day 3" into a cheap experiment.
**Cost.** L (snapshot indexing, deterministic replay ordering, scrubber UI).
**Phase.** P8 (snapshots + read-only replay), branching in P15.

### 6.5 Saved searches / smart collections

**Problem.** "All unverified accounts touched this week" is a question asked daily and re-typed
daily.
**Solution.** Any search + filter state can be saved as a named collection in the project rail.
A collection is a live query (`{ text, types[], tags[], confidence_range, date_range, has_edge_type,
source_tool }`) evaluated against the Postgres projection, with a count badge and a "select all on
board" action. Collections are per-project, shareable, and exportable in JSON v1.
**UX justification.** Turns retrieval into navigation; also becomes the input surface for watchlists
(§6.9) and bulk operations (§6.16).
**Cost.** M.
**Phase.** P7.

### 6.6 Relationship confidence

**Problem.** "Same person" asserted from a matching username is far weaker than from a signed
commit email, yet both draw the same line.
**Solution.** Edges carry `confidence` and `basis` (see §6.1) and render distinctly: ≥ 0.8 solid,
0.4–0.79 dashed 6/4, < 0.4 dotted 2/4 at 60% opacity. Edge inspector exposes the control; graph
algorithms (clustering, path finding) accept a confidence threshold slider so the analyst can ask
"show me only the strong graph".
**UX justification.** A single slider turns a spaghetti board into a defensible core, which is the
main complaint about link-analysis views.
**Cost.** S (schema + stroke styles) + S (threshold in view controls).
**Phase.** P5.

### 6.7 Entity merge / split

**Problem.** Two nodes turn out to be the same entity (or one node was wrongly conflated from two).
Without a first-class operation users delete and lose provenance.
**Solution.** **Merge**: pick a survivor, union of tags/attributes with per-field conflict chooser,
all edges re-pointed, merged node records `merged_from: [ids]` and keeps both provenance chains;
the operation is one undoable transaction. **Split**: select attributes/edges to move to a new
node; original keeps the rest; a `same_as` edge with confidence 0.5 is offered but not forced.
**UX justification.** Makes the graph correctable, which is the precondition for trusting it at all.
Conflict chooser prevents silent data loss (`00_MASTER.md` §1.3).
**Cost.** L (edge re-pointing, conflict UI, undo across many objects).
**Phase.** P4 (merge), P14 (split).

### 6.8 Node history diffing

**Problem.** In a shared board, "this node says something different than yesterday" has no answer.
**Solution.** Per-node change list derived from the projection's `node_revisions` table (written by
the projection hook), rendered as a field-level diff (old → new) with author, timestamp, and origin
(`user | tool | ai | import`). Actions: restore a field, restore the whole revision, copy diff.
**UX justification.** Field-level, not blob-level, so the reader sees the _claim_ that changed. This
is also the audit evidence Devon's legal team asks for (J2.4).
**Cost.** M (revision rows are a by-product of projection; UI is the work).
**Phase.** P8.

### 6.9 Watchlists with change alerts

**Problem.** Infrastructure and profiles change after the investigation "ends"; manual re-running is
forgotten.
**Solution.** Mark any node (or a smart collection, §6.5) as watched with an interval
(`6h / daily / weekly`). A BullMQ repeatable job re-runs the node's originating manifest, hashes the
normalized output, and on change creates a **Change proposal**: a diff card in the inbox lane plus
optional email/webhook. Watch state is visible as an eye badge; a project-level watch budget caps
runs/day to keep cost predictable and avoid abusive polling.
**UX justification.** Converts a snapshot tool into a monitoring tool without adding a second
product surface; using proposals keeps N4 intact.
**Cost.** L (scheduling, output hashing per manifest, notification transport).
**Phase.** P12 (after ≥ 2 real integrations exist).

### 6.10 Chain-of-custody export

**Problem.** Findings shared as PDF are not defensible: no hashes, no capture times, no tool
versions.
**Solution.** A ZIP bundle: `manifest.json` (board id, export time, exporter identity, tool
versions + image digests used, node/edge counts), `nodes.json` (full JSON v1), `blobs/` (raw
payloads and screenshots, named by SHA-256), `provenance.json` (the §6.2 DAG), `report.pdf`, and
`SHA256SUMS`. Optional detached signature if the deployment configures a signing key
(`15_SECURITY.md` §7).
**UX justification.** One command produces the artifact a lawyer, editor or client auditor accepts;
it also makes Raven boards re-importable elsewhere, which is a trust argument for self-hosters.
**Cost.** M (mostly assembly over existing export + hashing).
**Phase.** P15.

### 6.11 Redaction mode for sharing

**Problem.** Sharing a board externally today means building a sanitized copy by hand — error-prone
and immediately stale.
**Solution.** A per-share **redaction profile**: rules by node type, tag, field or explicit node
list, applied as a _view transform_ at export/share time (values replaced with `[redacted:reason]`,
images blurred at 24 px radius server-side, blobs excluded). A preview shows exactly what the
recipient sees, with a count of redacted items and a hard warning if any unredacted node carries the
`sensitive` tag.
**UX justification.** Non-destructive: the source board is untouched, so redaction can never cause
data loss, and profiles are reusable per client.
**Cost.** L (rule engine + server-side image processing + preview).
**Phase.** P15.

### 6.12 Offline capture queue

**Problem.** Offline (plane, field work) the app can create nodes locally but cannot unfurl, thumb
or run tools; users then distrust offline mode entirely.
**Solution.** Nodes created offline are fully valid and marked `pending_enrichment`. A visible queue
in the status bar ("3 items waiting for connection") lists what will happen on reconnect. On
reconnect the queue drains with a rate limit of 4 concurrent unfurls; each result arrives as a
normal enrichment patch, and failures stay in the queue with a retry action rather than vanishing.
**UX justification.** Makes the offline promise legible instead of magic; the user knows what is
missing and why the card looks bare.
**Cost.** M.
**Phase.** P6.

### 6.13 Canvas templates for investigation types

**Problem.** A blank infinite canvas is the worst possible first screen; also every analyst
re-invents the same skeleton.
**Solution.** Board templates shipped as JSON v1 fragments: _Person investigation_, _Domain /
infrastructure_, _Repository due diligence_, _Incident timeline_, _Competitive landscape_,
_Literature review_. Each provides labeled placeholder groups, pre-typed nodes, a suggested edge
palette, and 2–3 inline coach cards that delete themselves once the user creates a real node of
that kind. Users can save any board as a template (structure only, content stripped).
**UX justification.** Teaches structure by example, which is far cheaper than documentation, and
directly serves J3.3.
**Cost.** M (template loader + 6 authored templates).
**Phase.** P7.

### 6.14 Quick-triage inbox lane

**Problem.** Fast capture pollutes the canvas: 30 pasted URLs land on top of the analyst's careful
layout.
**Solution.** A collapsible right-edge lane (toggle `Ctrl+Shift+I`) that receives captures when the
canvas has no explicit paste target, when capture happens from the extension/mobile, or when the
user drops into it. Items are compact rows with type, title, source and age; actions: `Enter` place
on canvas at viewport center, `E` open inspector, `X` archive, `D` delete, `Shift+↓` multi-select.
Lane count is shown in the status bar; the lane is board-scoped and part of the document.
**UX justification.** Separates _collecting_ from _composing_, the single most requested behavior in
whiteboard-style tools, without adding a second app.
**Cost.** M.
**Phase.** P6.

### 6.15 Focus mode

**Problem.** At 500+ nodes the neighborhood of interest is buried in noise.
**Solution.** `F` on a selection enters focus mode: the selection plus its N-hop neighborhood
(N adjustable 1–3 with `1/2/3`) stays at full opacity; everything else drops to 12% opacity and
becomes non-interactive; camera eases to fit the focus set in 220 ms. Optional "hide" instead of
"dim" for screenshots. `Escape` exits and restores the previous camera exactly.
**UX justification.** Non-destructive attention control that needs no layout change and no new data;
restoring the camera precisely is what makes it safe to use constantly.
**Cost.** S (renderer already has per-node style resolution).
**Phase.** P2 (dim), neighborhood expansion P5.

### 6.16 Bulk operations

**Problem.** Post-import cleanup (200 Sherlock results) is unbearable one node at a time.
**Solution.** With ≥ 2 nodes selected, the inspector switches to a bulk panel: set/add/remove tags,
set confidence, set color, set type (only within compatible type families), connect all to a target
node with a chosen edge type, group, lock, hide, delete, export selection, run integration on all.
Every bulk action is a single undo entry with a summary toast ("Tagged 143 nodes · Undo").
**UX justification.** One undo entry per intent, not per object, is what makes bulk operations
usable rather than terrifying.
**Cost.** M.
**Phase.** P4 (core), extended each phase that adds a node property.

### 6.17 Keyboard-only capture

**Problem.** The mouse round-trip breaks flow during a burst of note-taking, and it excludes users
who cannot use a pointer.
**Solution.** `Ctrl+Shift+A` opens quick-add at the last caret position: a single input with a type
prefix grammar (`u ` url, `t ` text, `p ` person, `@` username, `r ` repo, `#` tag-on-last-node,
`?` hypothesis, `>` connect to the currently selected node). `Enter` creates and stays open,
`Shift+Enter` creates and closes, `Tab` cycles inferred type. New nodes are auto-placed by a
spiral placement algorithm that avoids overlap within a 600 px radius of the viewport center.
**UX justification.** Serves both flow and N6 accessibility with one mechanism instead of two.
**Cost.** M (grammar + placement).
**Phase.** P6.

### 6.18 Pinned reference rail

**Problem.** A few nodes (the target identity, the brief, the timeline) are consulted constantly but
scroll away.
**Solution.** Pin up to 8 nodes to a left-edge rail of 56 px thumbnails. Hover expands a preview
card; click pans to the node; `Alt+1..8` jumps directly. Pins are per-user per-board (ephemeral UI
state in Zustand, persisted in local storage, _not_ in the Y.Doc) so collaborators do not fight over
them.
**UX justification.** Deliberately per-user: shared pins create conflict; personal pins create
speed. Also gives a stable "home" that reduces zoom-lost disorientation.
**Cost.** S.
**Phase.** P4.

### 6.19 Cross-project reference index

**Problem.** The same indicator appearing in two engagements is the highest-value signal a team has,
and it is invisible when projects are silos.
**Solution.** The projection maintains a normalized `entity_keys` table (`kind`, `normalized_value`,
`node_id`, `project_id`). When a node is created whose key exists in another project the user may
read, a subtle "Seen in 2 other projects" chip appears; opening it lists project, board, date and
the analyst, gated by ACL (invisible if the user lacks read access). Actions: open in split view,
copy node into this board (with `same_as` edge and full provenance), or dismiss.
**UX justification.** Cross-project recall with zero manual bookkeeping; ACL-aware so it cannot leak
between clients — which is exactly the concern that would otherwise kill the feature.
**Cost.** L (index maintenance, ACL filtering, split view).
**Phase.** P7 (index + chip), split view P14.

### 6.20 Hypothesis nodes with supporting / contradicting edges

**Problem.** Boards hold facts but not _theories_, so reasoning happens in the analyst's head and
cannot be reviewed.
**Solution.** A `hypothesis` node type: statement, status (`open | supported | refuted |
inconclusive`), owner, created/updated. Edges `supports` and `contradicts` (with confidence, §6.6)
connect evidence to it. The node renders a live tally (green support weight vs red contradiction
weight computed as Σ confidence) and refuses to auto-conclude — status is always set by a human.
**UX justification.** Makes reasoning an object on the board that a reviewer can attack, which is
the core of analytic tradecraft.
**Cost.** M.
**Phase.** P5 (needs typed edges).

### 6.21 ACH (Analysis of Competing Hypotheses) view

**Problem.** With 3+ hypotheses, pairwise support tallies do not reveal which evidence actually
_discriminates_ between theories.
**Solution.** A matrix view: rows = evidence nodes, columns = hypotheses, cells =
`consistent (+) / inconsistent (−) / neutral (·) / n-a` set by click or keyboard. Columns show a
weighted inconsistency score (Σ of inconsistent-cell confidences, lower = more likely, per standard
ACH practice); rows show a diagnosticity score (variance of cell values across columns) so the
analyst can sort by "most discriminating evidence". Cells write real `supports`/`contradicts` edges,
so the matrix and the graph are one dataset, not two.
**UX justification.** The matrix is the only affordance that surfaces diagnosticity; sharing storage
with the graph avoids the classic "two truths" bug.
**Cost.** L.
**Phase.** P14.

### 6.22 Report builder with citation numbering

**Problem.** Turning a board into a document is currently manual copy-paste and citations rot.
**Solution.** A document editor beside the canvas. Dragging a node in inserts an inline citation
`[n]`, numbered in first-appearance order and renumbered automatically on reorder. Section templates
(Executive summary / Scope & authorization / Method / Findings / Confidence & gaps / Appendix:
evidence). AI can draft a section as a Proposal that may only cite nodes present on the board;
uncited assertions are highlighted with `[unsourced]` and block export in `governance_mode`.
Export to PDF/Markdown with an auto-generated evidence appendix (id, type, source URL, capture time,
hash, confidence).
**UX justification.** Citations as first-class references, not text, is what makes them survive
editing — the failure mode of every hand-written report.
**Cost.** XL.
**Phase.** P15.

### 6.23 Presentation mode (extended beyond the client's §31)

**Problem.** The client asked for a presentation mode; the naive version (fullscreen canvas) does
not help a walkthrough of a 300-node board.
**Solution.** Ordered **scenes**, each storing a camera rect, a focus set, an optional caption and
a per-scene reveal order for nodes/edges. Playback: `→/←` next/prev with a 320 ms eased camera
tween, `B` blank screen, `S` speaker notes on a second window, `Esc` exit to the exact prior camera.
Scenes are generated automatically from groups as a starting point and then edited.
**UX justification.** Camera-based, so the board is never mutated for presentation; auto-generation
means the feature has value before any authoring effort.
**Cost.** L.
**Phase.** P15.

### 6.24 Board health panel

**Problem.** Large boards silently accumulate orphans, unsourced claims, stale nodes and duplicate
candidates; quality decays invisibly.
**Solution.** A panel with computed, clickable metrics: orphan nodes (degree 0), nodes without
source, nodes with confidence < 0.4, unresolved duplicate candidates, watched nodes with pending
changes, nodes not touched in > 30 days, hypotheses with zero evidence. Each row selects the
offending set on the canvas so the fix is one bulk operation away (§6.16).
**UX justification.** Converts vague unease into a finite worklist; pairs with §6.16 to make cleanup
a two-minute task instead of an afternoon.
**Cost.** M (all metrics are single projection queries).
**Phase.** P14.

### 6.25 Feature/phase summary table

| #    | Feature                            | Cost | Phase    |
| ---- | ---------------------------------- | ---- | -------- |
| 6.1  | Evidence confidence scoring        | M    | P4 / P15 |
| 6.2  | Source attribution chain           | M    | P9 / P13 |
| 6.3  | Duplicate detection                | M+S  | P6 / P13 |
| 6.4  | Investigation replay / time-travel | L    | P8 / P15 |
| 6.5  | Saved searches / smart collections | M    | P7       |
| 6.6  | Relationship confidence            | S    | P5       |
| 6.7  | Entity merge / split               | L    | P4 / P14 |
| 6.8  | Node history diffing               | M    | P8       |
| 6.9  | Watchlists with change alerts      | L    | P12      |
| 6.10 | Chain-of-custody export            | M    | P15      |
| 6.11 | Redaction mode                     | L    | P15      |
| 6.12 | Offline capture queue              | M    | P6       |
| 6.13 | Canvas templates                   | M    | P7       |
| 6.14 | Quick-triage inbox lane            | M    | P6       |
| 6.15 | Focus mode                         | S    | P2 / P5  |
| 6.16 | Bulk operations                    | M    | P4+      |
| 6.17 | Keyboard-only capture              | M    | P6       |
| 6.18 | Pinned reference rail              | S    | P4       |
| 6.19 | Cross-project reference index      | L    | P7 / P14 |
| 6.20 | Hypothesis nodes                   | M    | P5       |
| 6.21 | ACH view                           | L    | P14      |
| 6.22 | Report builder with citations      | XL   | P15      |
| 6.23 | Presentation mode with scenes      | L    | P15      |
| 6.24 | Board health panel                 | M    | P14      |

Total added scope: 2 S, 10 M, 8 L, 1 XL (plus split items). Phase load is deliberately weighted to
P4–P7 (cheap, high-leverage) and P14–P15 (analysis and output), keeping P2–P3 focused on the
architecture-defining canvas and document layers.

---

## 7. Success metrics

Metrics are computed from the local event stream (§3.6). Self-hosted deployments may disable
transmission entirely; the definitions still apply to a deployment's own dashboard.

### 7.1 Activation (first session)

| Metric                     | Definition                                                                | Target                  |
| -------------------------- | ------------------------------------------------------------------------- | ----------------------- |
| A1 Time to first node      | app interactive → first node created                                      | p50 ≤ 45 s, p90 ≤ 120 s |
| A2 Time to first edge      | first node → first edge                                                   | p50 ≤ 4 min             |
| A3 First-session structure | % of first sessions with ≥ 5 nodes and ≥ 3 edges                          | ≥ 60%                   |
| A4 Paste discovery         | % of first sessions using `Ctrl+V` capture                                | ≥ 70%                   |
| A5 Palette discovery       | % of first sessions opening `Ctrl+K`                                      | ≥ 40%                   |
| A6 Documentation need      | % of first sessions where the primary flow completes without opening help | ≥ 90%                   |

### 7.2 Retention & depth

| Metric                 | Definition                                           | Target         |
| ---------------------- | ---------------------------------------------------- | -------------- |
| R1 Week-2 return       | users active in days 8–14 after signup               | ≥ 45%          |
| R2 Board revisit       | % of boards opened on ≥ 3 distinct days              | ≥ 50%          |
| R3 Enrichment adoption | % of active users running ≥ 1 integration in week 1  | ≥ 35%          |
| R4 Proposal acceptance | accepted / total proposals (AI + import)             | 0.45–0.80 band |
| R5 Report completion   | % of boards with ≥ 40 nodes producing an export      | ≥ 30%          |
| R6 Provenance coverage | % of nodes with a non-null source on exported boards | ≥ 95%          |

R4 is a two-sided guardrail: below 0.45 the suggestion quality is bad; above 0.80 users are likely
rubber-stamping, which endangers N4's intent, and the AI layer must then reduce proposal volume and
raise its confidence threshold (`14_AI_AGENT.md` §6).

### 7.3 Performance SLOs (product-level; engineering budgets in `16_PERFORMANCE.md`)

| ID  | Surface                                                   | Budget                         |
| --- | --------------------------------------------------------- | ------------------------------ |
| S1  | Cold load to interactive canvas, 1,000-node board, cached | ≤ 2.5 s p95                    |
| S2  | Pan/zoom frame time, 5,000 nodes / 10,000 edges           | ≤ 16.6 ms p95 (N1)             |
| S3  | Paste → node visible                                      | ≤ 400 ms p95                   |
| S4  | Unfurl complete                                           | ≤ 3 s p95, ≤ 10 s hard timeout |
| S5  | Local search first results                                | ≤ 150 ms p95                   |
| S6  | Command palette open → rendered                           | ≤ 80 ms p95                    |
| S7  | View switch (graph/table/timeline)                        | ≤ 250 ms p95                   |
| S8  | Local durability of a mutation                            | ≤ 100 ms (N2)                  |
| S9  | Server ack of a mutation                                  | ≤ 2 s p95 (N2)                 |
| S10 | Integration run queued → visible progress                 | ≤ 1 s p95                      |
| S11 | Report draft, 300-node board                              | ≤ 10 s p95                     |
| S12 | Memory ceiling, 5,000-node board                          | ≤ 1.2 GB tab RSS               |

### 7.4 Quality metrics

Undo success rate 100% for enumerated mutation types (N3, e2e enforced); data-loss incidents 0
(N2); axe-core critical violations 0 (N6); p95 error-toast rate < 0.5% of user actions; duplicate
false-merge rate < 1% measured on the fixture corpus in `18_TESTING.md` §6.

---

## 8. Non-goals

Explicit, with the reason each is refused. A PR implementing any of these is a gate failure unless
this document is amended first.

1. **Not a general whiteboard.** No freehand drawing, no shape library, no sticky-note aesthetics.
   Typed entities only; a `note` node is the escape hatch.
2. **Not a document editor.** Rich text exists inside nodes and the report builder, not as a
   competing document surface with pages and templates.
3. **Not a task manager.** No assignees, due dates, boards-as-kanban. Comments and mentions only.
4. **Not a scraper or crawler.** Raven fetches URLs the user provides (one page, SSRF-guarded, no
   recursive crawling, robots-respecting) and delegates deep collection to tools the operator has
   authorized.
5. **Not a people-search product.** No aggregated personal-data database, no built-in breach
   corpora, no identity resolution as a service.
6. **Not an anti-bot evasion toolkit.** No CAPTCHA solving, no residential proxy rotation shipped,
   no fingerprint spoofing.
7. **Not a SIEM / log platform.** No high-volume ingestion, no detection rules, no alert triage
   queue beyond §6.9 watchlists.
8. **Not real-time chat.** Presence and comments, not a messaging surface.
9. **Not mobile-first.** Mobile is capture + read (`03_UX.md` §18); graph authoring stays desktop.
10. **Not an autonomous agent platform.** The AI proposes; humans accept (N4). No unattended
    multi-step agents mutating boards.
11. **Not a BI tool.** Table view supports investigation, not dashboards, pivots or scheduled
    reports.
12. **No SEO/marketing surface in the app.** It is an authenticated SPA (`00_MASTER.md` §2).
13. **No second database, search cluster or graph DB** before scale forces it (`00_MASTER.md` §2).
14. **No vendor-locked AI.** Provider-abstracted; running with a local OpenAI-compatible endpoint
    must remain fully functional (degraded quality is acceptable, broken features are not).

---

## 9. Packaging notes (monetization-neutral)

No prices, no plan names are decided here. What is decided is that **capability boundaries must be
enforceable by data, not by code forks**, so any future packaging decision is a configuration change.

### 9.1 Mechanism

- Every gateable capability has an entry in a `capabilities` table and is checked through one
  function, `can(actor, capability, scope)` (`15_SECURITY.md` §3). No feature checks a plan name.
- Default deployment (self-host) grants **all** capabilities with quotas set to local resource
  limits. Self-hosting is never crippled: it is the trust argument for P1/P2 users.
- Quota types: seats, projects, boards per project, nodes per board (soft warn at 5,000, hard guard
  at 20,000), integration runs/day, AI tokens/month, storage GB, watchlist runs/day, retention days.
- Metering writes usage rows in the same transaction as the run/AI call, so quota accounting can
  never drift from actual consumption.

### 9.2 Natural boundaries (observation, not commitment)

| Layer       | Contents                                                                              | Rationale                                                                                |
| ----------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Individual  | full canvas, nodes, edges, capture, offline, export, templates, local search          | the core loop must be complete alone, or P1 rejects the product                          |
| Team        | realtime sync, presence, comments, audit log, RBAC, cross-project index, watchlists   | costs are server-side and value is team-side                                             |
| Governance  | SSO/SAML, retention policy, redaction profiles, signed chain-of-custody, audit export | enterprise procurement items, no effect on the core loop                                 |
| Consumption | AI tokens, integration runs, storage                                                  | pass-through variable cost; must be visible in-app before spending (`14_AI_AGENT.md` §8) |

### 9.3 Rules

1. Never gate a _data_ capability (export, import, offline). Locking a user's data in is a product
   failure regardless of business model.
2. Never gate accessibility, security or provenance features.
3. Quota exhaustion degrades gracefully with the §12 error pattern: what happened, why, what to do
   (`03_UX.md` §12), and never loses work in progress.
4. Any gate must be visible _before_ the user invests effort, not after.

---

## 10. Legal and ethical positioning

### 10.1 Stance

Raven is a workspace for **authorized research**: publicly available information, assets the user
owns or is contractually permitted to assess, and data lawfully obtained. It is not an
anonymity-preserving offensive tool, and it does not attempt to help users evade detection or
access controls.

### 10.2 Product-level enforcement

| Control                           | Behavior                                                                                                                                                                                                                                              | Spec                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Acceptable-use acknowledgement    | on first project creation and on first use of any manifest marked `intrusiveness: active`, a one-screen acknowledgement naming the operator's responsibility; recorded in the audit log with timestamp and actor                                      | `15_SECURITY.md` §9                    |
| Authorization field               | every project has optional `authorization_note` (engagement ref, scope, dates); if empty, exported reports print "Authorization: not recorded" rather than nothing                                                                                    | `08_DATA_MODEL.md` §4                  |
| Manifest intrusiveness classes    | `passive` (public metadata, no target contact), `semi-active` (contacts target-owned public endpoints, e.g. Sherlock profile probes), `active` (scanning/enumeration). Semi-active and active require explicit per-run confirmation naming the target | `10_INTEGRATIONS.md` §4                |
| Egress allowlist                  | runner has no direct network; a proxy enforces per-manifest destination allowlists, so a tool cannot silently target anything else                                                                                                                    | `00_MASTER.md` §2, `15_SECURITY.md` §5 |
| robots and rate limits            | unfurl respects `robots.txt` for the fetched URL, sends an identifying user agent, one request per URL, no recursion                                                                                                                                  | `09_BACKEND.md` §5                     |
| No built-in personal-data corpora | no breach dumps, no aggregated PII databases shipped or bundled                                                                                                                                                                                       | this document §8.5                     |
| Retention & deletion              | project retention policy (default: keep until deleted); hard-delete removes blobs, projection rows and snapshots within 24 h and is recorded in the audit log                                                                                         | `15_SECURITY.md` §8                    |
| Minors and sensitive categories   | UI copy in the acknowledgement explicitly names special-category data and minors as areas requiring legal basis; no feature targets them                                                                                                              | `15_SECURITY.md` §9                    |

### 10.3 What we deliberately do not do

We do not police content (no classifiers scanning user boards — that would violate the privacy of
self-hosted analysts and is trivially bypassed). Instead we constrain _capabilities_ (§10.2) and
make _accountability_ cheap: audit log, provenance, authorization note, chain-of-custody. This is
the honest trade: the operator remains legally responsible, and the product makes their compliance
evidence a by-product of normal use rather than extra work.

### 10.4 Data handling defaults

Telemetry off by default in self-host; AI calls disabled until a provider is configured, with a
one-screen disclosure of exactly what leaves the deployment (node titles/bodies of the selected
scope, never blobs, never other projects); no third-party analytics scripts in the SPA; all outbound
destinations enumerable in the deployment's config and printable from the admin screen.

---

## 11. Open risks

| #   | Risk                                                                                                                                   | Impact                                 | Mitigation / trigger                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | SpiderFoot shows LOW maintenance activity (0 commits/issues in 90 days per deps.dev, June 2026); v4.0 API may drift or go unmaintained | P12 slips or ships a broken adapter    | pin image digest, isolate behind the manifest adapter, contract tests against a recorded fixture; fallback = ship P12 with a reduced module set and document a "bring your own SpiderFoot endpoint" mode (`12_SPIDERFOOT.md` §2) |
| R2  | Self-proposed scope (24 features, 8 L + 1 XL) inflates P14–P15 beyond delivery capacity                                                | GA date slips                          | features are individually flag-gated; the P15 cut list, in order, is §6.21 ACH view, §6.11 redaction profiles beyond field-level, §6.4 branching                                                                                 |
| R3  | Report builder (§6.22, XL) is the largest single item and depends on rich text + export + AI                                           | late discovery of integration problems | prototype the citation model in P4 rich text (`06_NODE_SYSTEM.md` §5) so P15 is assembly, not invention                                                                                                                          |
| R4  | Proposal acceptance may sit above 0.80 (rubber-stamping), defeating N4's intent                                                        | provenance quality degrades silently   | R4 metric is a release-blocking guardrail; response is fewer, higher-confidence proposals, not more UI                                                                                                                           |
| R5  | Confidence scoring (§6.1) can become theatre if users never adjust the default                                                         | reports carry false precision          | default is the tool-declared value, never "confirmed"; board health panel (§6.24) surfaces low-confidence claims; report marks < 0.4 as unconfirmed                                                                              |
| R6  | Cross-project index (§6.19) risks leaking client A into client B if ACL filtering has a bug                                            | severe trust and possibly legal breach | index queries always ACL-filtered server-side, never client-side; dedicated e2e suite with two isolated orgs; feature default OFF per project                                                                                    |
| R7  | Watchlists (§6.9) can look like unauthorized continuous monitoring of a target                                                         | legal/ethical exposure                 | watch requires re-confirming authorization for semi-active/active manifests; per-project run budget; watch state and history visible in the audit log                                                                            |
| R8  | Three personas pull the UI in different directions (speed vs governance vs structured output)                                          | interface bloat                        | governance features are additive and off by default; structured output is a view over the same graph; any new panel must serve ≥ 2 personas or replace something                                                                 |
| R9  | Mobile experience (§`03_UX.md` §18) is a second UI to maintain                                                                         | maintenance cost, drift                | mobile reuses the domain and data layers unchanged, ships only capture+read surfaces, and is explicitly excluded from canvas-authoring parity                                                                                    |
| R10 | Duplicate detection false merges could destroy analyst work                                                                            | data integrity                         | merge is always user-confirmed and undoable as one transaction; `merged_from` retains lineage so an undo is exact; false-merge rate is a tracked metric (§7.4)                                                                   |
| R11 | Metrics in §7 require event instrumentation that self-hosters may disable, leaving product decisions blind                             | slower iteration                       | targets are also verifiable in the lab (Playwright scripted first-run session + benchmark harness), so no metric depends solely on field telemetry                                                                               |
