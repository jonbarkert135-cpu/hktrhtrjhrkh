# ADR-003 — IndexedDB + OPFS as the local store; Postgres stays the server store

**Status:** accepted · 2026-08-18 · **Decided with the product owner**, who runs the app on localhost
and a small VPS today and wants a full multi-user VPS deployment to remain possible.

## Context

Local mode needs somewhere to put three different things: the board document (a Yjs CRDT), binary
attachments, and the list of projects and boards. The candidates were IndexedDB, OPFS, SQLite
(via WASM in the browser or `better-sqlite3` in a local Node process), and a local file directory
through the File System Access API.

## Decision

| Data                       | Store                                            | Why                                                                          |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Board document + history   | IndexedDB via `y-indexeddb`                      | Already shipped in P3; a CRDT update log is an append-only blob, not a table |
| Attachments                | OPFS (IndexedDB fallback, memory as last resort) | Already shipped in P3; large blobs, no query needs                           |
| Projects / boards metadata | IndexedDB (`raven-workspace`)                    | Two small keyed lists; one index (`boards.projectId`) covers every read      |
| Server deployment          | PostgreSQL 16 + pgvector                         | Already built: schema, migrations, audit log, file rows                      |

**SQLite is deliberately not adopted now.** In the browser it means a WASM build plus an OPFS VFS —
a large dependency and a second persistence engine next to the CRDT log that would still not be the
document's source of truth. Outside the browser it means Electron or a local Node process, i.e.
re-introducing the backend that local mode exists to remove.

**When to revisit:** when a single workspace holds enough nodes that list/search over metadata
becomes slow in practice (order 10⁴–10⁵ nodes with full-text search). At that point SQLite-WASM
becomes a third `WorkspaceRepository` implementation. Nothing above the interface changes — that is
the whole reason the interface exists.

## Consequences

Zero install, offline by construction, and one storage engine per kind of data. The limits are
honest ones: browser storage can be evicted under pressure (the app surfaces quota failures as
actionable copy and offers export), and there is no cross-device story in local mode by design.
