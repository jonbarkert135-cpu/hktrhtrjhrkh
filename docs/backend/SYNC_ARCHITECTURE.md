# Sync architecture — designed, not built

**State: not started** (`CLOUD_SYNC_ENABLED` exists as a capability and is off everywhere).

## Why this is the easy part later

Board documents are already CRDTs. `apps/web/src/data/persistence.ts` attaches `y-indexeddb` to the
`Y.Doc` and reports a status machine (`saving` / `saved` / `offline` / `error`) that was written with
a second provider in mind. Adding sync is adding a _second_ provider to the same document, not
changing how the document works.

## The plan

1. **Transport**: Hocuspocus over WebSocket (`SYNC_URL`), one room per board.
2. **Authorization**: the API signs a short-lived board token (`SYNC_SHARED_SECRET` already exists in
   the env schema); the sync service verifies it and never talks to the database directly.
3. **Client**: `createPersistence()` gains a `WebsocketProvider` alongside the IndexedDB one. Merge
   semantics are Yjs's; there is no conflict resolution to write.
4. **Status UI**: `apps/web/src/data/syncStatus.ts` gains the server states (`syncing`, `synced`,
   `conflict-free`) — the reducer was shaped for this and the tests already pin the local subset.
5. **Files**: attachments must be uploaded to object storage before a board is shareable; the presign
   path (`apps/api/src/trpc/routers/files.ts`) already exists, so this is a migration of local blobs,
   not new machinery.
6. **Local→cloud migration**: export the local project archive, import it into the server workspace.
   Ids are cuid2 from the same generator, so nothing is renumbered.

## Non-goals

Sync is not required for collaboration to be _specified_, but collaboration is required to be after
it: `COLLABORATION_ENABLED` declares `cloudSync` as a dependency, and the registry refuses the
combination that skips it.
