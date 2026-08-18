# ADR-004 — Repository and transport abstractions as the only mode-aware seams

**Status:** accepted · 2026-08-18

## Context

Two deployment shapes can be implemented in two ways: conditionals at every call site, or one
interface with two implementations. The first is cheaper to write once and impossible to keep
correct; the second forces the question "what does this feature mean without a server?" to be
answered while the feature is being written.

## Decision

Exactly three seams exist, and mode-awareness lives only in them:

1. **`WorkspaceRepository`** — `apps/web/src/data/workspace/types.ts`. Projects and boards.
   Implementations: `local.ts` (IndexedDB), `server.ts` (tRPC). Chosen in `app/providers.tsx`.
2. **Upload transport** — the `UploadApi` + `BlobPut` seams of `apps/web/src/files/upload.ts`.
   Implementations: `localTransport.ts` (OPFS) and the presigned-S3 path. Chosen in `useUpload.ts`.
3. **Route guards and account UI** — `app/router.tsx` and `app/shell/Shell.tsx` read
   `capabilities.auth`, because a build with no accounts must not merely hide `/login`, it must not
   have the route.

The interfaces are deliberately free of React, tRPC and Prisma types: anything that appears in them
has to be implementable by both sides, which is the check that stops server concepts (orgs, roles,
presence) from becoming implicit requirements of local mode.

Also decided: **no mocks in the core.** Where a server-only feature has no local meaning, the UI is
absent, not faked. There is no "Coming soon" sync indicator and no stub Google button.

## Consequences

Adding a data feature costs two implementations and two test suites. In exchange the local build is
provably serverless (`localMode.test.tsx`), and turning a deployment on is a configuration change
rather than a migration.
