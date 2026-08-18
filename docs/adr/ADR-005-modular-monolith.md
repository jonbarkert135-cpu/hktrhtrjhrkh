# ADR-005 — Modular monolith, one deployable per shape

**Status:** accepted · 2026-08-18

## Context

The specification describes several backend services (API, sync, tool runner, worker). It would be
easy to read that as "microservices", and equally easy to over-correct into a single file. Local mode
adds a further pressure: the browser bundle must be able to stand alone.

## Decision

- **Local mode is one deployable**: static files from `apps/web/dist`. No server component at all.
- **Server mode is a modular monolith**: `apps/api` is one process containing the tRPC routers, auth,
  audit and file endpoints, separated by module boundaries enforced with dependency-cruiser
  (`.dependency-cruiser.cjs`) rather than by network hops.
- Additional processes are added only when the workload genuinely differs: `apps/worker` for
  thumbnails and long jobs (P6), the sync service for CRDT fan-out (P8), the tool runner for
  sandboxed execution. Each is a separate process because of isolation or scaling, never because of
  layering aesthetics.
- Shared logic lives in `packages/*` (`domain`, `db`, `config`, `ui`, `canvas-engine`) and is imported
  by both shapes; the domain package contains no I/O, which is why the same file-policy code runs in
  the browser and on the server.

## Consequences

One repository, one test run, one deploy per shape. The cost is that server mode scales as a unit
until a piece is genuinely extracted — acceptable at this size, and the module boundaries are already
where the extraction seams would be.
