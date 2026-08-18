# ADR-001 — Local-first now, backend-ready later

**Status:** accepted · 2026-08-18
**Supersedes:** nothing. **Amends:** the deployment assumptions in `RAVEN-SPEC/19_DEPLOYMENT.md`.

## Context

Raven was specified as a multi-user product: Postgres, Redis, S3, accounts, an org model, a sync
service. That is the right end state, but it is the wrong starting state for the way the product is
actually being used today — one person, on a laptop or a small VPS, who wants to open a board and
work. Requiring Docker, a database and a sign-up before the first node can be drawn is a cost paid
every day for a capability needed later.

At the same time, throwing the backend away would be expensive to undo: the schema, the tRPC
routers, the audit log and the file pipeline are built, tested and green in CI.

## Decision

Ship **two deployment shapes from one code base**, selected by `APP_MODE`:

- **`local` (the default)** — no account, no server, no database, no network. Board documents,
  attachments and the project list live on the device. `pnpm install && pnpm dev:local` is the whole
  setup, and a static build of `apps/web` is a complete product.
- **`server`** — the existing API, database, accounts and (later) sync and collaboration.

Rules that make this more than a flag:

1. **One registry.** Every optional subsystem is named in `packages/config/src/appMode.ts` and
   nowhere else. Product code asks for a capability (`capabilities.auth`), never for the mode.
2. **Contradictions fail at boot.** Enabling a networked capability while `APP_MODE=local`, or
   enabling one whose dependency is off, throws `AppModeConfigError` with the fix in the message.
3. **Abstractions, not branches.** Data access goes through `WorkspaceRepository`
   (`apps/web/src/data/workspace/`) with a local and a server implementation; uploads go through the
   `UploadApi`/`BlobPut` seams with a local (OPFS) and a server (presigned S3) transport. Components
   contain no mode checks beyond the router guard and the account menu.
4. **The backend is not deleted.** It is documented as dormant in `docs/backend/BACKEND_STATUS.md`
   and stays covered by CI.
5. **Local mode is not a relaxed mode.** The file-type sniffing, size caps and rejection copy are the
   same code the API runs, so a project made locally is valid on a deployment.

## Consequences

**Good.** Clone-to-running is minutes without Docker. The app works offline and on a plane. A VPS
deployment can be a static file server today and a full stack later, with no data model rewrite.

**Costs.** Two implementations of one interface must both be tested — the suites are
`apps/web/src/data/workspace/*.test.ts` and `src/files/localTransport.test.ts`. Local mode has no
cross-device sync and no sharing; that is the honest trade and it is stated in the UI, not hidden.

**The acceptance test that keeps this true:** `apps/web/src/app/localMode.test.tsx` renders the whole
app with `fetch`, `XMLHttpRequest` and `WebSocket` replaced by throwing stubs. If any component ever
reaches for the network in local mode, that suite fails in CI rather than the user's browser.
