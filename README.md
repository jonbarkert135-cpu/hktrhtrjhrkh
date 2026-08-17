# NEXUS — Advanced Research & Intelligence Canvas

> An infinite canvas over a typed knowledge graph, for authorized OSINT and research work.
> Collect anything, link everything, enrich it with open-source tooling, export a defensible report.

**Status: Phase 0 — architecture frozen, specification complete. Implementation starts at Phase 1.**

---

## What is in this repository

| Path | Contents |
|---|---|
| [`NEXUS-SPEC/`](NEXUS-SPEC/) | The complete product + engineering specification (21 documents) |
| [`NEXUS-SPEC/00_MASTER.md`](NEXUS-SPEC/00_MASTER.md) | **Start here.** Frozen architecture decisions, principles, non-negotiables, phases, quality gate |
| [`NEXUS-SPEC/20_ROADMAP.md`](NEXUS-SPEC/20_ROADMAP.md) | Phase-by-phase implementation prompts (P1…P16) — one PR per phase |
| `Дорожная карта для ии разроботчика сайта.md` | The original client brief + the live progress tracker |

## How development works here

1. Pick the next unchecked phase in `NEXUS-SPEC/20_ROADMAP.md`.
2. Read `00_MASTER.md` plus the spec documents that phase points to.
3. Branch `feat/pNN-<slug>`, implement exactly that phase, open a PR.
4. The PR body must show the seven quality-gate checks (`00_MASTER.md` §8) with evidence.
5. Tick the phase in `20_ROADMAP.md` and in the root progress tracker in the same PR.

Nothing is implemented "later": if a capability is in the core vision, it has a full architectural
solution in the spec before code is written.

## Architecture in one paragraph

TypeScript everywhere. A React 19 + Vite SPA renders a **custom hybrid canvas engine** — Canvas2D
for edges, grid and far-zoom level-of-detail glyphs, DOM overlay for the visible near-zoom cards —
driven by a spatial index so 5,000 nodes stay at 60 fps. The board document is a **Yjs CRDT**
(offline-first via IndexedDB, realtime via Hocuspocus, undo/redo via `Y.UndoManager`), projected
into **PostgreSQL** for querying, search and export. Every external tool — GitHub, Sherlock,
SpiderFoot and anything added later — is described by a **manifest** and executed by one generic
sandboxed runner pipeline, so the application core contains no tool-specific code. Nothing enters
the graph without provenance, and no AI or tool output is applied without a reviewable, undoable
proposal.

Full reasoning, rejected alternatives and the measured constraints behind each choice:
[`NEXUS-SPEC/00_MASTER.md`](NEXUS-SPEC/00_MASTER.md) §2 and [`NEXUS-SPEC/02_ARCHITECTURE.md`](NEXUS-SPEC/02_ARCHITECTURE.md).

## Legal & ethical scope

NEXUS is built for **authorized research**: your own assets, public information, and engagements you
have permission to run. Every tool run records a consent scope and is written to the audit log.
See `NEXUS-SPEC/15_SECURITY.md` §9.
