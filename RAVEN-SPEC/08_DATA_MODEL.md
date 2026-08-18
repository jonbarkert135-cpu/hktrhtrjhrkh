# 08 — DATA MODEL

## Scope

Defines every place Raven data lives and how those places stay consistent: the `Y.Doc` schema
(shared types, key naming, what is deliberately outside the CRDT, transaction origins, undo scope,
subdocs, snapshots, GC), the complete PostgreSQL 16 schema as Prisma models plus the resulting SQL
with every index, constraint and isolation rule, the Yjs→Postgres projection contract
(ordering, idempotency, replay, consistency checks), versioning/history/replay, and the
export/import formats with the lossless round-trip guarantee (`00_MASTER.md` N9). Node payloads are
specified in `06_NODE_SYSTEM.md`, edge payloads in `07_EDGE_SYSTEM.md`, query/API surfaces in
`09_BACKEND.md`.

---

## 1. The two-store rule

```text
   Client                         Sync service                    Postgres
 ┌──────────┐  Yjs update    ┌──────────────────┐  same tx  ┌────────────────────┐
 │  Y.Doc   │ ─────────────► │ Hocuspocus 4     │ ────────► │ board_snapshots    │  ← authoritative bytes
 │ (board)  │ ◄───────────── │  onStoreDocument │           │ nodes/edges/groups │  ← queryable projection
 └──────────┘   awareness    └──────────────────┘           └────────────────────┘
      │                                                              ▲
      │ y-indexeddb (offline)                                        │ read: search, export,
      ▼                                                              │ integrations, reports
   IndexedDB + OPFS blobs
```

- **The `Y.Doc` binary is authoritative.** If the projection and the CRDT disagree, the CRDT wins
  and the projection is rebuilt from it (§5.6).
- **The projection is never written by application code**, only by the projector. A DB trigger is
  not used; a code-level rule (`no-direct-projection-write` lint) plus a `projector` DB role with
  the only INSERT/UPDATE grants on `nodes`/`edges`/`groups` enforce it.
- Everything that is _not_ board content (users, orgs, ACL, runs, files, audit) lives only in
  Postgres and is never in a `Y.Doc`.

---

## 2. Y.Doc schema

### 2.1 Document granularity

**One `Y.Doc` per board**, `guid = "board:" + boardId`. Hocuspocus room name is the same string.
A project with 30 boards is 30 documents, loaded on demand.

Rationale: board is the unit of collaboration, of access control (`ShareLink` targets a board) and
of the performance budget. A project-level document would force every client to load every board.

### 2.2 Top-level shared types

```ts
// packages/domain/src/doc/schema.ts
export function initBoardDoc(doc: Y.Doc) {
  doc.getMap('meta'); // Y.Map<unknown>   board metadata (see 2.2.1)
  doc.getMap('nodes'); // Y.Map<Y.Map>     nodeId  -> node map
  doc.getMap('edges'); // Y.Map<Y.Map>     edgeId  -> edge map
  doc.getMap('groups'); // Y.Map<Y.Map>     groupId -> group map (frames/clusters)
  doc.getMap('richtext'); // Y.Map<Y.XmlFragment>  fragmentKey -> fragment
  doc.getMap('comments'); // Y.Map<Y.Map>     commentId -> comment map (thread head + replies)
  doc.getArray('order'); // Y.Array<string>  explicit z-order of node ids (see 2.2.4)
  doc.getMap('assets'); // Y.Map<Y.Map>     fileId -> {name, mime, size, sha256, state}
}
```

There are exactly eight top-level keys. Adding a ninth is a document-format migration (§8.6).

#### 2.2.1 `meta`

| key                       | type                              | notes                                                   |
| ------------------------- | --------------------------------- | ------------------------------------------------------- |
| `schemaVersion`           | number                            | current `1`; gates migrations (§8.6)                    |
| `boardId`                 | string (ULID)                     | mirrors Postgres `boards.id`                            |
| `projectId`               | string (ULID)                     |                                                         |
| `title`                   | string                            | board title; also mirrored to Postgres by the projector |
| `description`             | string                            |                                                         |
| `createdAt` / `updatedAt` | ISO string                        | `updatedAt` written at most once per 5 s                |
| `background`              | `'grid' \| 'dots' \| 'plain'`     |                                                         |
| `defaultEdgeRouting`      | `'smart' \| …`                    | board default for `07_EDGE_SYSTEM.md` §7                |
| `tagPalette`              | `Record<tag, colorToken>`         | board-scoped tag colors                                 |
| `savedViews`              | `Array<{id,name,camera,filters}>` | named camera+filter bookmarks                           |
| `lastMigratedAt`          | ISO string                        |                                                         |

#### 2.2.2 node maps

`nodes.get(id)` is a `Y.Map` whose keys are exactly the top-level keys of `EntityBase`
(`06_NODE_SYSTEM.md` §2): `id, type, x, y, w, h, rotation, z, parentId, locked, hidden, title,
tags, confidence, provenance, color, starred, status, enrichment, createdAt, updatedAt, version,
data, deletedAt`.

Rules:

- `tags` is a plain JS array (not `Y.Array`). Tag edits are whole-array replacements; concurrent
  tag edits therefore last-writer-wins per node. This is deliberate: tag arrays are ≤ 64 short
  strings and merge-by-union at the array level would produce surprising resurrection of removed
  tags. Set-union semantics are provided at the _action_ level instead (`addTag` reads-modifies-
  writes inside a transaction).
- `data` is a nested `Y.Map` **only** for types with independently editable subfields
  (`website`, `person`, `organization`, `repository`, `domain`, `ip`, `evidence`); for the rest it
  is a plain object. The registry declares this via `def.crdtNestedData: boolean`. Reason:
  concurrent editing of two different fields of the same person must merge; a sticky's `text` does
  not need it.
- `provenance` and `enrichment` are plain objects (replaced wholesale; they are written by one
  writer at a time by construction).
- Arrays inside `data` (e.g. `person.aliases`, `domain.records`) are plain arrays for the same
  reason as `tags`, except `evidence.sourceUrls` and `person.profileUrls`, which are `Y.Array`
  because multiple analysts genuinely append to them concurrently.
- **Unknown keys are never deleted.** A client that loads a node with keys it does not recognize
  (newer schema, plugin type) leaves them untouched. Validation strips them only for the in-memory
  typed view, never in the CRDT (`06_NODE_SYSTEM.md` §4.21).

#### 2.2.3 edge maps

`edges.get(id)` is a `Y.Map` with the keys of the `Edge` schema (`07_EDGE_SYSTEM.md` §2).
`source`/`target`/`style` are nested `Y.Map`s (endpoint re-attach and style tweaks are independent
concurrent operations). `waypoints` is a plain array (a manual route is a single coherent artifact;
merging two users' waypoint edits would produce nonsense — last writer wins, and the loser's version
is recoverable from history).

#### 2.2.4 `order`

`Y.Array<string>` of node ids in paint order (back → front). Groups are pinned to the front of the
array's "floor" section; the renderer sorts by `(isGroup ? 0 : 1, orderIndex)`.
`z` on the node map is a denormalized integer kept in sync by the reorder helpers, used by the
projection and by exports so that a consumer without the array still gets the right order. Reorder
operations (`bringToFront`, `sendBackward`, …) move ids inside the `Y.Array` — a CRDT array move is
implemented as delete+insert inside one transaction, which is correct and idempotent under merge
(a duplicated id after a concurrent move is repaired by `checkGraphInvariants`, §7.3).

#### 2.2.5 `richtext`

`Y.Map<Y.XmlFragment>` keyed by `fragmentKey` (`fk_` + ULID). Owned by exactly one node; the owner
is discoverable through `nodes[*].data.fragmentKey`. Orphan fragments (owner deleted) are removed by
the GC pass (§2.8) 30 days after the owning node is purged.

#### 2.2.6 `assets`

Board-local index of files referenced by nodes: `{ name, mime, size, sha256, state: 'local'|'uploading'|'synced'|'missing' }`.
The bytes are never in the CRDT. This map exists so an offline client can render file cards with
correct names/sizes before the Postgres `files` row is reachable.

### 2.3 What is NOT in the CRDT

| Data                                                            | Where it lives                                                 | Why not in the doc                           |
| --------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| Camera (x, y, zoom)                                             | Zustand + `localStorage` per `(boardId, userId)`               | per-user, high frequency; would spam updates |
| Selection, hover, focus                                         | Zustand (ephemeral)                                            | per-user                                     |
| Awareness: cursor, viewport rect, selection preview, name/color | Yjs **awareness** protocol (not the doc)                       | ephemeral by design, not persisted           |
| Panel layout, inspector tab, sidebar width                      | `localStorage`                                                 | UI state                                     |
| Filters, search query, view mode                                | Zustand; nameable into `meta.savedViews` when the user opts in | ephemeral until named                        |
| Routing geometry, label boxes, spatial index                    | in-memory caches (`07_EDGE_SYSTEM.md` §11.3)                   | derived                                      |
| Undo stack                                                      | `Y.UndoManager` in memory                                      | per-session                                  |
| Trash contents                                                  | in-doc via `deletedAt` (soft), not a separate list             | one source of truth                          |
| Presence typing indicators, comments "seen"                     | awareness / Postgres                                           | ephemeral / server-owned                     |
| Files bytes                                                     | OPFS + S3                                                      | binary bloat                                 |
| Tool run logs, raw payloads                                     | Postgres + S3                                                  | append-only, large                           |

Rule of thumb enforced in review: **if two users editing it concurrently do not need a merge, it is
not in the document.**

#### 2.2.7 Implementation note (P3)

The schema above is implemented in `packages/domain/src/doc/`. Two details were pinned down while
building it:

- Node/edge/group records are `Y.Map`s of plain JSON values; nested `Y.Map` payloads for the types
  listed in §2.2.2 arrive with the node registry in P4. Unknown keys are already preserved on read,
  write, export and import, so that change is additive.
- `order` is repaired (`pruneOrder`) inside the same transaction as any node delete, so invariant
  §7.4 cannot be violated between two transactions.

### 2.4 Transactions and origins

Every mutation goes through one helper:

```ts
export type Origin =
  | 'local:create'
  | 'local:edit'
  | 'local:move'
  | 'local:delete'
  | 'local:action'
  | 'local:paste'
  | 'local:layout'
  | 'local:merge'
  | 'local:proposal-apply'
  | 'remote:sync'
  | 'remote:enrich'
  | 'remote:projection-repair'
  | 'system:migration'
  | 'system:gc'
  | 'system:import';

export function tx<T>(doc: Y.Doc, origin: Origin, fn: (t: Y.Transaction) => T): T {
  return doc.transact(fn, origin);
}
```

Rules:

1. No code calls `doc.transact` directly; the lint rule `require-tx-helper` enforces it.
2. One user gesture = one transaction. A paste of 40 nodes + 60 edges is a single transaction, so it
   is a single undo step and a single projection batch.
3. Origins beginning with `remote:` or `system:` are excluded from the undo scope (§2.5).
4. `local:move` transactions are throttled: during a drag, positions are written to a local
   "ghost" store and committed to the doc on pointer-up **plus** every 250 ms (so collaborators see
   motion) — each interim commit uses origin `local:move` and the `UndoManager` capture timeout
   (500 ms) merges them into one undo step.

### 2.5 Undo scope

```ts
new Y.UndoManager(
  [
    doc.getMap('nodes'),
    doc.getMap('edges'),
    doc.getMap('groups'),
    doc.getMap('richtext'),
    doc.getArray('order'),
    doc.getMap('meta'),
  ],
  {
    trackedOrigins: new Set([
      'local:create',
      'local:edit',
      'local:move',
      'local:delete',
      'local:action',
      'local:paste',
      'local:layout',
      'local:merge',
      'local:proposal-apply',
    ]),
    captureTimeout: 500,
    ignoreRemoteMapChanges: true,
  },
);
```

- Undo is **local-origin scoped**: Ctrl+Z never reverts a collaborator's edit (N3 requires undo to
  work for every mutation _the user made_, including tool imports and AI actions — those arrive as
  `local:proposal-apply` because the user accepted them, which is exactly why they are undoable).
- Background enrichment (`remote:enrich`) is not undoable by design; the user-facing equivalent is
  the explicit, undoable `Clear enrichment` action (`06_NODE_SYSTEM.md` §9.4).
- `comments` is deliberately **not** in the undo scope: undoing a canvas edit must not delete a
  colleague's comment.
- Stack depth: `Y.UndoManager` is unbounded by default; Raven caps it at 200 items by dropping the
  oldest on push (custom wrapper), which bounds memory on long sessions.
- After `undo()`/`redo()`, the affected node ids are collected from the resulting transaction and
  the camera pans to their bounding box only if none of them is visible (`03_UX.md` §9).

### 2.6 Update volume and document size

| Control                    | Value                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| Scalar field debounce      | 180 ms (`06_NODE_SYSTEM.md` §9.5)                                                 |
| Drag position commit       | on pointer-up + every 250 ms                                                      |
| `meta.updatedAt` write     | at most 1 per 5 s                                                                 |
| Awareness update rate      | ≤ 20 Hz, cursor quantized to 2 canvas units                                       |
| Max nodes per board (soft) | 5,000 — warning banner at 4,500, hard cap 20,000 with a "split this board" prompt |
| Max edges per board (soft) | 10,000 — same pattern, hard cap 40,000                                            |
| Target doc size at 5k/10k  | ≤ 9 MB encoded (measured in `bench/doc-size.bench.ts`)                            |

### 2.7 Subdocuments

Board content stays in the board doc. Two things are `Y.Doc` **subdocs**, loaded lazily:

1. `comments:<boardId>` — comment threads. Loaded when the comments panel opens or when a comment
   marker is visible. Keeps a board with 4,000 comments from inflating the main document.
2. `history-cache:<boardId>` — client-side cache of recently loaded `HistoryEvent` pages for the
   timeline scrubber. Purely a cache; the server is authoritative.

Project-level data (board list, tags, saved searches) is **not** a Yjs doc — it is Postgres, read
through tRPC. Only the canvas needs CRDT semantics.

### 2.8 Snapshots and garbage collection

- Yjs GC is **enabled** (`doc.gc = true`) for live documents: deleted content is collapsed into
  delete-sets, which is what keeps a long-lived board small.
- Because GC destroys the ability to compute `Y.snapshot`-based historical states, point-in-time
  history is provided by **stored snapshots + HistoryEvents** (§6), not by CRDT time travel. This
  is a deliberate trade: unbounded document growth is a worse failure mode than coarser history.
- Snapshot cadence (`board_snapshots`, §4.7): on every `onStoreDocument` debounce (2 s idle or
  10 s max) the _current state_ is written to the `current` row (one per board, upserted); a
  **durable** snapshot is additionally appended when any of: 200 update-transactions since the last
  durable snapshot, 15 minutes elapsed with changes, a named checkpoint created by the user, before
  a schema migration, or before an import/merge/AI proposal application ≥ 50 nodes.
- Retention: all durable snapshots for 7 days; then hourly-latest for 30 days; then daily-latest for
  180 days; named checkpoints forever. Purge runs nightly (`19_DEPLOYMENT.md` §7).
- Each durable snapshot stores `Y.encodeStateAsUpdateV2` bytes (zstd level 6 in object storage when
  > 256 KB, inline `bytea` otherwise), plus `state_vector`, `node_count`, `edge_count`, `checksum`
  > (sha256 of the update bytes).

---

## 3. Postgres conventions

### 3.1 Primary keys — ULID

**All primary keys are ULIDs stored as `CHAR(26)`** (Crockford base32, uppercase).

Justification (one line as required): the client must mint ids offline inside a CRDT transaction, so
the id must be generated without the server; ULID is time-sortable (so `ORDER BY id` gives insertion
order and B-tree inserts stay right-hand-side, unlike uuidv4), it is 26 readable chars in URLs and
logs, and it needs no `uuid-ossp`/`pg_uuidv7` extension on every deployment target — self-hosting is
a requirement (`00_MASTER.md` §2). uuidv7 would be equivalent technically but is not uniformly
available as a native generator across the Postgres 16 builds we must support, and 16 bytes of
binary hurts debuggability more than 26 bytes of char helps storage here.

```sql
CREATE DOMAIN ulid AS CHAR(26)
  CHECK (VALUE ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$');
```

Server-side generation uses a `ulid()` SQL function (pl/pgsql, monotonic within a transaction)
installed by the first migration; clients use the `ulid` npm package. Ids are never reused.

### 3.2 Common columns

Every table has: `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` (maintained by a shared
`set_updated_at()` trigger). Tables that are user-visible content also have
`deleted_at TIMESTAMPTZ` (soft delete) and every query path uses a partial index with
`WHERE deleted_at IS NULL`.

Soft-delete policy:

| Class                                                  | Policy                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Board content (`nodes`, `edges`, `groups`, `comments`) | soft delete, purged 30 days after `deleted_at`                                          |
| `boards`, `projects`                                   | soft delete, purged 60 days after `deleted_at`                                          |
| `files`                                                | soft delete + reference counting; bytes purged 24 h after the last reference disappears |
| `users`                                                | soft delete (anonymize PII, keep audit references)                                      |
| `audit_logs`, `history_events`, `integration_runs`     | **never** deleted; retention by partition drop only                                     |
| Everything else                                        | hard delete with FK cascade                                                             |

### 3.3 Tenancy and row-level isolation

Tenant = `organization`. Every content table carries `org_id ulid NOT NULL` (denormalized on
purpose — it makes RLS a single index lookup rather than a join chain).

```sql
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY nodes_tenant ON nodes
  USING (org_id = current_setting('app.org_id', true)::text)
  WITH CHECK (org_id = current_setting('app.org_id', true)::text);
```

- Every request handler opens its transaction with
  `SET LOCAL app.org_id = $1; SET LOCAL app.user_id = $2;` derived from the authenticated session.
- The application connects as `raven_app`, a role **without** `BYPASSRLS`. Migrations run as
  `raven_migrate`; the projector runs as `raven_projector` (also RLS-bound, org id taken from the
  board being projected).
- Project/board level permissions are **not** expressed in RLS (too dynamic); they are enforced in
  the API authorization layer (`09_BACKEND.md` §3) and re-checked in the Hocuspocus `onAuthenticate`
  hook. RLS is the backstop that makes a missing `WHERE` clause a non-event rather than a breach.

### 3.4 JSONB discipline

`jsonb` is used for: node/edge `data`, tool payload summaries, manifest snapshots, file metadata,
settings. Rules: (a) every jsonb column that is filtered has a GIN index (`jsonb_path_ops` when only
containment is queried); (b) any field that appears in a `WHERE` more than occasionally is promoted
to a real column by a migration; (c) jsonb is never used for foreign keys.

---

## 4. Prisma models and SQL

The Prisma schema lives at `packages/db/prisma/schema.prisma`. Below, each model is followed by the
DDL that matters (indexes/constraints Prisma cannot express go into
`packages/db/prisma/migrations/*/manual.sql`).

```prisma
generator client { provider = "prisma-client-js" }
datasource db    { provider = "postgresql"; url = env("DATABASE_URL"); extensions = [pgcrypto, pg_trgm, vector] }
```

### 4.1 User

```prisma
model User {
  id            String   @id @db.Char(26)
  email         String   @unique @db.Citext
  emailVerified Boolean  @default(false)
  name          String   @db.VarChar(200)
  avatarFileId  String?  @db.Char(26)
  locale        String   @default("en") @db.VarChar(16)
  timezone      String   @default("UTC") @db.VarChar(64)
  lastSeenAt    DateTime?
  deletedAt     DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  memberships   Membership[]
  projectMembers ProjectMember[]
  auditLogs     AuditLog[]
  @@index([lastSeenAt])
}
```

Auth records (sessions, accounts, verification tokens) are owned by Better-Auth and live in its own
tables (`auth_session`, `auth_account`, `auth_verification`), referenced by `user_id`. They are not
re-modelled here; the only Raven constraint is `auth_session.user_id → users.id ON DELETE CASCADE`.

### 4.2 Organization / Membership

```prisma
model Organization {
  id        String   @id @db.Char(26)
  slug      String   @unique @db.VarChar(60)
  name      String   @db.VarChar(200)
  plan      String   @default("self-hosted") @db.VarChar(32)
  settings  Json     @default("{}")
  deletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  members   Membership[]
  projects  Project[]
}

model Membership {
  id        String   @id @db.Char(26)
  orgId     String   @db.Char(26)
  userId    String   @db.Char(26)
  role      OrgRole
  invitedBy String?  @db.Char(26)
  joinedAt  DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([orgId, userId])
  @@index([userId])
}
enum OrgRole { owner admin member viewer }
```

```sql
-- at least one owner per org
CREATE UNIQUE INDEX memberships_single_owner_guard
  ON memberships (org_id) WHERE role = 'owner' AND joined_at IS NOT NULL;
-- NOTE: this enforces exactly one owner; multi-owner orgs use role 'admin'.
-- Justification: a single accountable owner simplifies deletion and billing semantics.
```

### 4.3 Project / ProjectMember

```prisma
model Project {
  id          String   @id @db.Char(26)
  orgId       String   @db.Char(26)
  key         String   @db.VarChar(24)          // short human key, unique per org
  name        String   @db.VarChar(200)
  description String?  @db.VarChar(2000)
  color       String?  @db.VarChar(40)          // design token name
  archivedAt  DateTime?
  deletedAt   DateTime?
  createdBy   String   @db.Char(26)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  org         Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  boards      Board[]
  members     ProjectMember[]
  @@unique([orgId, key])
  @@index([orgId, archivedAt])
}

model ProjectMember {
  id        String   @id @db.Char(26)
  projectId String   @db.Char(26)
  userId    String   @db.Char(26)
  role      ProjectRole
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([projectId, userId])
  @@index([userId])
}
enum ProjectRole { owner editor commenter viewer }
```

### 4.4 Board

```prisma
model Board {
  id           String   @id @db.Char(26)
  orgId        String   @db.Char(26)
  projectId    String   @db.Char(26)
  title        String   @db.VarChar(300)
  description  String?  @db.VarChar(2000)
  schemaVersion Int     @default(1)
  nodeCount    Int      @default(0)
  edgeCount    Int      @default(0)
  lastEditedAt DateTime?
  lastEditedBy String?  @db.Char(26)
  projectionSeq BigInt  @default(0)   // monotonic sequence of applied projections (§5)
  thumbnailFileId String? @db.Char(26)
  deletedAt    DateTime?
  createdBy    String   @db.Char(26)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  project      Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  nodes        Node[]
  edges        Edge[]
  snapshots    BoardSnapshot[]
  @@index([projectId, deletedAt])
  @@index([orgId, lastEditedAt(sort: Desc)])
}
```

### 4.5 Node (projection)

```prisma
model Node {
  id          String   @id @db.Char(26)
  orgId       String   @db.Char(26)
  boardId     String   @db.Char(26)
  type        String   @db.VarChar(48)
  title       String   @default("") @db.VarChar(300)
  x  Float
  y  Float
  w  Float
  h  Float
  z  Int      @default(0)
  parentId    String?  @db.Char(26)
  confidence  String   @default("unverified") @db.VarChar(16)
  status      String   @default("active") @db.VarChar(16)
  data        Json     @default("{}")
  provenance  Json     @default("{}")
  searchText  String?  @db.Text          // maintained by the projector (06 §3 searchFields)
  identityKeys String[] @db.VarChar(320) // normalized dedupe keys (06 §10.1)
  version     Int      @default(1)
  docUpdatedAt DateTime                  // node.updatedAt from the CRDT (ordering guard, §5.3)
  deletedAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  board       Board    @relation(fields: [boardId], references: [id], onDelete: Cascade)
  tags        NodeTag[]
  outEdges    Edge[]   @relation("edge_source")
  inEdges     Edge[]   @relation("edge_target")
  @@index([boardId, deletedAt])
  @@index([boardId, type])
  @@index([boardId, parentId])
}
```

```sql
CREATE INDEX nodes_data_gin        ON nodes USING gin (data jsonb_path_ops);
CREATE INDEX nodes_identity_gin    ON nodes USING gin (identity_keys);
CREATE INDEX nodes_fts             ON nodes USING gin (to_tsvector('simple', coalesce(search_text,'')));
CREATE INDEX nodes_title_trgm      ON nodes USING gin (title gin_trgm_ops);
-- viewport / bulk fetch of a board's live nodes, the single hottest query (09_BACKEND.md §5.1)
CREATE INDEX nodes_board_live      ON nodes (board_id, type, id) WHERE deleted_at IS NULL;
-- "recently touched in this org" for the dashboard (09_BACKEND.md §5.6)
CREATE INDEX nodes_org_recent      ON nodes (org_id, updated_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE nodes ADD CONSTRAINT nodes_size_ck   CHECK (w >= 24 AND h >= 24 AND w <= 8000 AND h <= 8000);
ALTER TABLE nodes ADD CONSTRAINT nodes_conf_ck   CHECK (confidence IN ('confirmed','high','medium','low','unverified'));
ALTER TABLE nodes ADD CONSTRAINT nodes_status_ck CHECK (status IN ('draft','active','archived'));
ALTER TABLE nodes ADD CONSTRAINT nodes_parent_fk FOREIGN KEY (parent_id)
  REFERENCES groups(id) ON DELETE SET NULL;
```

`nodes` is **partitioned by hash on `board_id` into 16 partitions**. Reason: the hottest queries are
always board-scoped, and hash partitioning keeps index sizes bounded as the deployment grows without
needing a partition-management job. Same for `edges`.

### 4.6 Edge (projection)

```prisma
model Edge {
  id           String   @id @db.Char(26)
  orgId        String   @db.Char(26)
  boardId      String   @db.Char(26)
  type         String   @db.VarChar(48)
  sourceNodeId String   @db.Char(26)
  targetNodeId String   @db.Char(26)
  directed     Boolean  @default(true)
  label        String   @default("") @db.VarChar(200)
  confidence   String   @default("unverified") @db.VarChar(16)
  weight       Float    @default(0.5)
  observedAt   DateTime
  validFrom    DateTime?
  validTo      DateTime?
  provenance   Json     @default("{}")
  data         Json     @default("{}")
  status       String   @default("active") @db.VarChar(16)
  version      Int      @default(1)
  docUpdatedAt DateTime
  deletedAt    DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  board        Board @relation(fields: [boardId], references: [id], onDelete: Cascade)
  source       Node  @relation("edge_source", fields: [sourceNodeId], references: [id], onDelete: Cascade)
  target       Node  @relation("edge_target", fields: [targetNodeId], references: [id], onDelete: Cascade)
  @@index([boardId, deletedAt])
}
```

```sql
-- neighbor lookup in both directions (07_EDGE_SYSTEM.md §12)
CREATE INDEX edges_src ON edges (board_id, source_node_id) WHERE deleted_at IS NULL;
CREATE INDEX edges_dst ON edges (board_id, target_node_id) WHERE deleted_at IS NULL;
-- duplicate prevention, and the lookup used by 07 §3.4
CREATE UNIQUE INDEX edges_unique_rel
  ON edges (board_id, source_node_id, target_node_id, type) WHERE deleted_at IS NULL;
-- temporal filtering for the timeline view
CREATE INDEX edges_temporal ON edges (board_id, observed_at) WHERE deleted_at IS NULL;
CREATE INDEX edges_type     ON edges (board_id, type) WHERE deleted_at IS NULL;
CREATE INDEX edges_data_gin ON edges USING gin (data jsonb_path_ops);
ALTER TABLE edges ADD CONSTRAINT edges_time_ck
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from);
ALTER TABLE edges ADD CONSTRAINT edges_weight_ck CHECK (weight >= 0 AND weight <= 1);
ALTER TABLE edges ADD CONSTRAINT edges_selfloop_ck
  CHECK (source_node_id <> target_node_id
         OR type IN ('references','mentions','communicates_with','knows'));
```

`ON DELETE CASCADE` from nodes is correct here because a _hard_ node delete only happens at purge
time, when the edge is meaningless. Soft deletes never cascade (the projector sets `deleted_at` on
orphaned edges explicitly, §5.4).

### 4.7 Group, BoardSnapshot

```prisma
model Group {
  id        String   @id @db.Char(26)
  orgId     String   @db.Char(26)
  boardId   String   @db.Char(26)
  kind      String   @default("frame") @db.VarChar(16)
  label     String   @default("") @db.VarChar(200)
  x Float
  y Float
  w Float
  h Float
  collapsed Boolean @default(false)
  parentId  String? @db.Char(26)
  data      Json    @default("{}")
  version   Int     @default(1)
  docUpdatedAt DateTime
  deletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([boardId, deletedAt])
}

model BoardSnapshot {
  id          String   @id @db.Char(26)
  orgId       String   @db.Char(26)
  boardId     String   @db.Char(26)
  kind        String   @db.VarChar(16)      // 'current' | 'durable' | 'checkpoint' | 'pre-migration'
  seq         BigInt
  update      Bytes?                        // inline when <= 256 KB
  objectKey   String?  @db.VarChar(512)     // S3 key when larger
  stateVector Bytes
  checksum    String   @db.Char(64)
  nodeCount   Int
  edgeCount   Int
  byteSize    Int
  label       String?  @db.VarChar(200)     // user label for checkpoints
  createdBy   String?  @db.Char(26)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  board       Board @relation(fields: [boardId], references: [id], onDelete: Cascade)
  @@unique([boardId, kind, seq])
  @@index([boardId, createdAt(sort: Desc)])
}
```

```sql
ALTER TABLE groups ADD CONSTRAINT groups_kind_ck CHECK (kind IN ('frame','cluster'));
ALTER TABLE groups ADD CONSTRAINT groups_parent_fk FOREIGN KEY (parent_id)
  REFERENCES groups(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX board_snapshots_current ON board_snapshots (board_id) WHERE kind = 'current';
ALTER TABLE board_snapshots ADD CONSTRAINT snapshot_storage_ck
  CHECK ((update IS NOT NULL) <> (object_key IS NOT NULL));
```

### 4.8 Tag / NodeTag

```prisma
model Tag {
  id        String   @id @db.Char(26)
  orgId     String   @db.Char(26)
  projectId String   @db.Char(26)
  name      String   @db.VarChar(48)      // normalized: lowercase, [a-z0-9-_/]
  color     String?  @db.VarChar(40)      // token name
  usageCount Int     @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  nodeTags  NodeTag[]
  @@unique([projectId, name])
  @@index([orgId, usageCount(sort: Desc)])
}

model NodeTag {
  nodeId String @db.Char(26)
  tagId  String @db.Char(26)
  createdAt DateTime @default(now())
  node   Node @relation(fields: [nodeId], references: [id], onDelete: Cascade)
  tag    Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([nodeId, tagId])
  @@index([tagId])
}
```

```sql
ALTER TABLE tags ADD CONSTRAINT tags_name_ck CHECK (name ~ '^[a-z0-9][a-z0-9/_-]{0,47}$');
```

### 4.9 File

```prisma
model File {
  id           String   @id @db.Char(26)
  orgId        String   @db.Char(26)
  projectId    String   @db.Char(26)
  uploaderId   String?  @db.Char(26)
  name         String   @db.VarChar(255)
  mime         String   @db.VarChar(160)      // server-sniffed, not client-declared
  declaredMime String?  @db.VarChar(160)
  size         BigInt
  sha256       String   @db.Char(64)
  objectKey    String   @db.VarChar(512)
  state        String   @default("pending") @db.VarChar(16) // pending|uploading|synced|failed|quarantined
  virusScan    String   @default("pending") @db.VarChar(16)
  metadata     Json     @default("{}")        // EXIF subset, pages, duration, dimensions
  renditions   Json     @default("{}")        // {thumb:{key,w,h}, card:…, view:…}
  refCount     Int      @default(0)
  deletedAt    DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([projectId, sha256])
  @@index([orgId, createdAt(sort: Desc)])
  @@index([state])
}
```

Content dedupe is per project (`@@unique([projectId, sha256])`): cross-project dedupe would leak the
existence of a file between investigations, which is unacceptable for OSINT tenants.
`refCount` is maintained by the projector (nodes referencing `fileId`); a file with `refCount = 0`
for 24 h is purged.

### 4.10 Integration, IntegrationInstall, IntegrationRun, ToolResult

```prisma
model Integration {
  id           String   @id @db.Char(26)
  slug         String   @unique @db.VarChar(64)   // 'github' | 'sherlock' | 'spiderfoot'
  name         String   @db.VarChar(120)
  version      String   @db.VarChar(40)
  manifest     Json                                // 10_INTEGRATIONS.md §3 manifest, frozen copy
  imageDigest  String?  @db.VarChar(120)           // pinned container digest (sha256:…)
  capabilities String[] @db.VarChar(64)
  official     Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  installs     IntegrationInstall[]
  @@index([slug, version])
}

model IntegrationInstall {
  id            String  @id @db.Char(26)
  orgId         String  @db.Char(26)
  integrationId String  @db.Char(26)
  enabled       Boolean @default(true)
  config        Json    @default("{}")     // non-secret config
  secretRef     String? @db.VarChar(200)   // pointer into the secret store; never a secret value
  installedBy   String  @db.Char(26)
  quota         Json    @default("{}")     // {runsPerDay, concurrent, maxDurationMs}
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  integration   Integration @relation(fields: [integrationId], references: [id], onDelete: Restrict)
  @@unique([orgId, integrationId])
}

model IntegrationRun {
  id            String   @id @db.Char(26)
  orgId         String   @db.Char(26)
  projectId     String   @db.Char(26)
  boardId       String?  @db.Char(26)
  installId     String   @db.Char(26)
  integrationSlug String  @db.VarChar(64)
  toolVersion   String    @db.VarChar(40)
  target        String    @db.VarChar(500)
  targetHash    String    @db.Char(64)        // sha256(normalized target) for dedupe/cache
  params        Json      @default("{}")
  status        String    @db.VarChar(16)     // queued|running|succeeded|partial|failed|cancelled|timeout
  exitCode      Int?
  errorCode     String?   @db.VarChar(80)
  errorMessage  String?   @db.VarChar(2000)
  startedAt     DateTime?
  finishedAt    DateTime?
  durationMs    Int?
  rawObjectKey  String?   @db.VarChar(512)
  logObjectKey  String?   @db.VarChar(512)
  stats         Json      @default("{}")
  requestedBy   String    @db.Char(26)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  results       ToolResult[]
  @@index([projectId, createdAt(sort: Desc)])
  @@index([integrationSlug, status])
  @@index([targetHash, integrationSlug, createdAt(sort: Desc)])
}

model ToolResult {
  id         String  @id @db.Char(26)
  orgId      String  @db.Char(26)
  runId      String  @db.Char(26)
  kind       String  @db.VarChar(48)     // 'account-found' | 'dns-record' | 'correlation' | …
  payload    Json
  entityHint Json    @default("{}")      // {type, identityKey} proposed by the parser
  nodeId     String? @db.Char(26)        // set when an import proposal was accepted
  confidence String  @default("medium") @db.VarChar(16)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  run        IntegrationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  @@index([runId, kind])
  @@index([nodeId])
}
```

```sql
CREATE INDEX tool_results_payload_gin ON tool_results USING gin (payload jsonb_path_ops);
-- integration_runs is partitioned by RANGE(created_at), monthly; retention 24 months
```

### 4.11 Entity resolution

```prisma
model EntityResolution {
  id            String  @id @db.Char(26)
  orgId         String  @db.Char(26)
  projectId     String  @db.Char(26)
  entityType    String  @db.VarChar(48)     // node type of the cluster
  identityKey   String  @db.VarChar(320)    // normalized key (06 §10.1)
  canonicalNodeId String @db.Char(26)
  memberNodeIds String[] @db.Char(26)
  score         Float
  method        String  @db.VarChar(24)     // 'identity' | 'heuristic' | 'ai' | 'manual'
  state         String  @db.VarChar(16)     // 'candidate' | 'confirmed' | 'rejected' | 'merged'
  mergedAt      DateTime?
  mergedBy      String?  @db.Char(26)
  evidence      Json     @default("{}")     // per-signal contributions (06 §10.1 table)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([projectId, entityType, identityKey, canonicalNodeId])
  @@index([projectId, state, score(sort: Desc)])
}
```

This table is what makes "the same person across three boards" answerable. It is maintained by the
projector for `identity`-method rows and by the dedupe job for the rest.

### 4.12 Repository, RepositoryAnalysis

```prisma
model Repository {
  id            String  @id @db.Char(26)
  orgId         String  @db.Char(26)
  provider      String  @db.VarChar(16)
  owner         String  @db.VarChar(120)
  name          String  @db.VarChar(140)
  url           String  @db.VarChar(2048)
  defaultBranch String? @db.VarChar(160)
  stars         Int?
  forks         Int?
  openIssues    Int?
  license       String? @db.VarChar(80)
  primaryLanguage String? @db.VarChar(60)
  languages     Json    @default("{}")
  topics        String[] @db.VarChar(60)
  pushedAt      DateTime?
  archived      Boolean?
  metadata      Json    @default("{}")
  lastFetchedAt DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  analyses      RepositoryAnalysis[]
  @@unique([provider, owner, name])
  @@index([orgId, updatedAt(sort: Desc)])
}

model RepositoryAnalysis {
  id           String  @id @db.Char(26)
  orgId        String  @db.Char(26)
  repositoryId String  @db.Char(26)
  commitSha    String  @db.Char(40)
  status       String  @db.VarChar(16)      // queued|running|succeeded|partial|failed
  steps        Json    @default("{}")       // per-step status (11_GITHUB.md §7)
  summary      String? @db.Text
  structure    Json    @default("{}")       // tree digest, entry points, module map
  dependencies Json    @default("{}")
  metrics      Json    @default("{}")       // loc, files, langs, test presence
  findings     Json    @default("[]")       // security/quality notes, each with a file+line ref
  modelId      String? @db.VarChar(80)
  tokensUsed   Int?
  costCents    Int?
  startedAt    DateTime?
  finishedAt   DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  repository   Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  @@unique([repositoryId, commitSha])
  @@index([orgId, createdAt(sort: Desc)])
}
```

### 4.13 AIAction, AIProposal

```prisma
model AIAction {
  id         String  @id @db.Char(26)
  orgId      String  @db.Char(26)
  projectId  String  @db.Char(26)
  boardId    String? @db.Char(26)
  kind       String  @db.VarChar(40)   // summarize|explain|suggest-links|dedupe|cluster|report
  inputRef   Json    @default("{}")    // node ids / selection descriptor, never raw content
  provider   String  @db.VarChar(40)
  modelId    String  @db.VarChar(80)
  promptHash String  @db.Char(64)
  status     String  @db.VarChar(16)
  tokensIn   Int?
  tokensOut  Int?
  costCents  Int?
  latencyMs  Int?
  errorCode  String? @db.VarChar(80)
  requestedBy String @db.Char(26)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  proposals  AIProposal[]
  @@index([projectId, createdAt(sort: Desc)])
  @@index([orgId, kind, createdAt(sort: Desc)])
}

model AIProposal {
  id         String  @id @db.Char(26)
  orgId      String  @db.Char(26)
  boardId    String  @db.Char(26)
  actionId   String? @db.Char(26)
  runId      String? @db.Char(26)      // set when the proposal comes from an integration run
  source     String  @db.VarChar(16)   // 'ai' | 'integration' | 'import' | 'system'
  title      String  @db.VarChar(300)
  rationale  String? @db.Text
  operations Json                       // ProposalOperation[] (§4.13.1)
  stats      Json    @default("{}")     // {addNodes, addEdges, updateNodes, conflicts}
  state      String  @db.VarChar(16)    // pending|accepted|partially-accepted|rejected|expired
  decidedBy  String? @db.Char(26)
  decidedAt  DateTime?
  appliedTxOrigin String? @db.VarChar(40)
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  action     AIAction? @relation(fields: [actionId], references: [id], onDelete: SetNull)
  @@index([boardId, state, createdAt(sort: Desc)])
}
```

#### 4.13.1 ProposalOperation

```ts
type ProposalOperation =
  | { op: 'add-node'; tempId: string; node: Omit<EntityBase, 'id'> & { id?: string } }
  | {
      op: 'update-node';
      nodeId: string;
      patch: Record<string, unknown>;
      before: Record<string, unknown>;
    }
  | {
      op: 'add-edge';
      tempId: string;
      edge: Omit<Edge, 'id'> & { source: { ref: string }; target: { ref: string } };
    }
  | {
      op: 'update-edge';
      edgeId: string;
      patch: Record<string, unknown>;
      before: Record<string, unknown>;
    }
  | { op: 'merge-nodes'; plan: MergePlan }
  | { op: 'add-tag'; nodeId: string; tag: string }
  | { op: 'archive-node'; nodeId: string };
```

`ref` in edge endpoints resolves to either an existing node id or a `tempId` from the same proposal.
Applying a proposal is exactly one Yjs transaction with origin `local:proposal-apply` ⇒ one undo
step (N3, N4). `before` snapshots make partial acceptance and rejection-after-apply exact.

### 4.14 HistoryEvent, Comment

```prisma
model HistoryEvent {
  id        String  @id @db.Char(26)
  orgId     String  @db.Char(26)
  boardId   String  @db.Char(26)
  seq       BigInt                       // per-board monotonic (from Board.projectionSeq)
  kind      String  @db.VarChar(48)      // taxonomy §6.1
  entityKind String @db.VarChar(12)      // 'node' | 'edge' | 'group' | 'board'
  entityId  String? @db.Char(26)
  actorId   String? @db.Char(26)
  actorKind String  @db.VarChar(12)      // 'user' | 'tool' | 'ai' | 'system'
  summary   String  @db.VarChar(300)
  diff      Json    @default("{}")       // JSON-pointer diff (§6.2)
  origin    String  @db.VarChar(40)      // Yjs transaction origin
  runId     String? @db.Char(26)
  proposalId String? @db.Char(26)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([boardId, seq, entityId, kind])
  @@index([boardId, createdAt(sort: Desc)])
  @@index([entityId, createdAt(sort: Desc)])
  @@index([boardId, actorId, createdAt(sort: Desc)])
}

model Comment {
  id         String  @id @db.Char(26)
  orgId      String  @db.Char(26)
  boardId    String  @db.Char(26)
  parentId   String? @db.Char(26)         // reply threading
  anchorKind String  @db.VarChar(12)      // 'node' | 'edge' | 'point'
  anchorId   String? @db.Char(26)
  anchorX    Float?
  anchorY    Float?
  bodyMd     String  @db.Text
  mentions   String[] @db.Char(26)
  resolvedAt DateTime?
  resolvedBy String? @db.Char(26)
  authorId   String  @db.Char(26)
  deletedAt  DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@index([boardId, resolvedAt, createdAt])
  @@index([anchorId])
}
```

`history_events` is partitioned by RANGE on `created_at` (monthly). Retention: 24 months hot, then
detached and archived to object storage.

### 4.15 SavedSearch, Watchlist, ShareLink

```prisma
model SavedSearch {
  id        String  @id @db.Char(26)
  orgId     String  @db.Char(26)
  projectId String  @db.Char(26)
  ownerId   String  @db.Char(26)
  name      String  @db.VarChar(200)
  query     String  @db.VarChar(2000)
  filters   Json    @default("{}")      // {types, tags, confidence, dateRange, boards}
  scope     String  @db.VarChar(16)     // 'private' | 'project'
  lastRunAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([projectId, ownerId, name])
}

model Watchlist {
  id          String  @id @db.Char(26)
  orgId       String  @db.Char(26)
  projectId   String  @db.Char(26)
  name        String  @db.VarChar(200)
  targetKind  String  @db.VarChar(24)   // 'username'|'domain'|'repository'|'saved-search'
  targetValue String  @db.VarChar(500)
  integrationSlug String? @db.VarChar(64)
  schedule    String  @db.VarChar(64)   // cron expression, min interval 1 hour
  lastRunAt   DateTime?
  lastRunId   String? @db.Char(26)
  notify      Json    @default("{}")    // {inApp:true, email:false, webhookUrl:null}
  enabled     Boolean @default(true)
  createdBy   String  @db.Char(26)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([projectId, targetKind, targetValue, integrationSlug])
  @@index([enabled, lastRunAt])
}

model ShareLink {
  id          String  @id @db.Char(26)
  orgId       String  @db.Char(26)
  boardId     String  @db.Char(26)
  tokenHash   String  @unique @db.Char(64)   // sha256 of the token; the token is never stored
  mode        String  @db.VarChar(16)        // 'view' | 'comment'
  passwordHash String? @db.VarChar(200)
  expiresAt   DateTime?
  maxViews    Int?
  viewCount   Int     @default(0)
  redactions  Json    @default("{}")         // {hideProvenance, hideTags, hideNodeTypes:[]}
  revokedAt   DateTime?
  createdBy   String  @db.Char(26)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([boardId, revokedAt])
}
```

### 4.16 AuditLog, WorkspaceSetting

```prisma
model AuditLog {
  id         String  @id @db.Char(26)
  orgId      String  @db.Char(26)
  actorId    String? @db.Char(26)
  actorKind  String  @db.VarChar(12)
  action     String  @db.VarChar(64)     // 'board.export', 'integration.run', 'share.create', …
  targetKind String  @db.VarChar(32)
  targetId   String? @db.Char(26)
  ip         String? @db.Inet
  userAgent  String? @db.VarChar(400)
  metadata   Json    @default("{}")
  outcome    String  @db.VarChar(16)     // 'success' | 'denied' | 'error'
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@index([orgId, createdAt(sort: Desc)])
  @@index([orgId, action, createdAt(sort: Desc)])
  @@index([targetId])
}

model WorkspaceSetting {
  id        String  @id @db.Char(26)
  orgId     String  @db.Char(26)
  key       String  @db.VarChar(80)
  value     Json
  updatedBy String? @db.Char(26)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([orgId, key])
}
```

`audit_logs` is append-only: `REVOKE UPDATE, DELETE ON audit_logs FROM raven_app;` and partitioned
monthly. Known keys for `WorkspaceSetting` include `maxFileSizeMb` (default 200),
`preserveOriginalExif` (default true), `allowEmbeds`, `aiProvider`, `aiMonthlyBudgetCents`,
`allowedIntegrationSlugs`, `mapTileTemplate`, `retentionDays`.

### 4.17 Embedding (pgvector)

```prisma
model Embedding {
  id        String  @id @db.Char(26)
  orgId     String  @db.Char(26)
  projectId String  @db.Char(26)
  ownerKind String  @db.VarChar(12)      // 'node' | 'edge' | 'file-chunk' | 'board-summary'
  ownerId   String  @db.Char(26)
  chunkIx   Int     @default(0)
  model     String  @db.VarChar(80)
  dim       Int
  contentHash String @db.Char(64)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([ownerKind, ownerId, chunkIx, model])
  @@index([projectId, ownerKind])
}
```

```sql
ALTER TABLE embeddings ADD COLUMN vec vector(1536);   -- Prisma cannot express the type
CREATE INDEX embeddings_hnsw ON embeddings
  USING hnsw (vec vector_cosine_ops) WITH (m = 16, ef_construction = 64);
ALTER TABLE embeddings ADD CONSTRAINT embeddings_dim_ck CHECK (dim = 1536);
```

Dimension is fixed at 1536 for the default provider; a different model dimension requires a new
table (`embeddings_<dim>`) rather than a nullable union column — HNSW indexes are per-dimension.
`content_hash` makes re-embedding idempotent: unchanged content is never re-embedded.

### 4.18 Foreign key / on-delete summary

| From                                    | To  | On delete                                    |
| --------------------------------------- | --- | -------------------------------------------- |
| memberships → organizations, users      |     | CASCADE                                      |
| projects → organizations                |     | CASCADE                                      |
| project_members → projects, users       |     | CASCADE                                      |
| boards → projects                       |     | CASCADE                                      |
| nodes/edges/groups → boards             |     | CASCADE                                      |
| edges → nodes (source/target)           |     | CASCADE                                      |
| nodes.parent_id → groups                |     | SET NULL                                     |
| node_tags → nodes, tags                 |     | CASCADE                                      |
| board_snapshots → boards                |     | CASCADE                                      |
| files → projects                        |     | RESTRICT (purge job must run first)          |
| integration_installs → integrations     |     | RESTRICT                                     |
| integration_runs → integration_installs |     | SET NULL (runs outlive uninstalls)           |
| tool_results → integration_runs         |     | CASCADE                                      |
| ai_proposals → ai_actions               |     | SET NULL                                     |
| repository_analyses → repositories      |     | CASCADE                                      |
| comments → boards                       |     | CASCADE                                      |
| history_events, audit_logs → anything   |     | **no FK** (append-only, must survive purges) |
| embeddings → owner                      |     | no FK; orphans removed by the nightly sweep  |

---

## 5. The projection contract

### 5.1 Where it runs

Hocuspocus `onStoreDocument` (debounced 2 s idle / 10 s max, `09_BACKEND.md` §4.2). One projection
job per board, serialized by an advisory lock `pg_advisory_xact_lock(hashtext('proj:'||board_id))`,
so two sync nodes can never project the same board concurrently.

### 5.2 Algorithm

```text
project(boardId, doc, prevSnapshotStateVector):
  BEGIN;
    SELECT projection_seq FROM boards WHERE id = boardId FOR UPDATE;
    lock advisory
    seq ← projection_seq + 1

    -- 1. compute the changed set cheaply
    changed ← diffKeys(doc, prevSnapshotStateVector)
              # from the accumulated update since the last stored snapshot:
              # decode the update, collect the set of touched map keys per top-level type.
              # Fallback (no prev vector, or decode failure): treat all keys as changed.

    -- 2. upsert in dependency order
    upsert groups(changed.groups)
    upsert nodes(changed.nodes)        -- parent_id references groups
    upsert edges(changed.edges)        -- references nodes
    soft-delete rows whose doc entry has deletedAt set
    hard-delete rows whose doc entry is absent AND present in DB AND
                the doc's delete-set proves removal (else: leave, flag for consistency check)

    -- 3. derived maintenance
    sync node_tags (diff against tags[])
    recompute boards.node_count / edge_count from the doc (cheap: map sizes)
    update files.ref_count deltas
    upsert entity_resolutions for identity-method keys
    append history_events for the changed set (§6)
    enqueue embedding jobs for nodes whose search_text hash changed

    -- 4. store the CRDT bytes
    upsert board_snapshots(kind='current')  with encodeStateAsUpdateV2(doc)
    maybe append a durable snapshot (§2.8 cadence)
    UPDATE boards SET projection_seq = seq, last_edited_at = now()
  COMMIT;
```

The snapshot write and the row upserts are in **one transaction** (`00_MASTER.md` §2.2). If the
projection fails, the snapshot is not committed either; the CRDT bytes are still safe in the
clients' IndexedDB and in the previous snapshot, and the update will be re-attempted on the next
store cycle.

### 5.3 Ordering and idempotency

- Each row carries `version` and `doc_updated_at` copied from the CRDT entry. Upserts are guarded:

```sql
INSERT INTO nodes (...) VALUES (...)
ON CONFLICT (id) DO UPDATE SET
   ... = EXCLUDED....
WHERE nodes.version < EXCLUDED.version
   OR (nodes.version = EXCLUDED.version AND nodes.doc_updated_at < EXCLUDED.doc_updated_at);
```

So an out-of-order projection (a retry landing after a newer one) can never move a row backwards.

- Geometry-only changes do not bump `version` (`06_NODE_SYSTEM.md` §9.6); for those the guard uses
  `doc_updated_at` alone, and geometry writes are coalesced — at most one geometry upsert per node
  per projection cycle.
- The whole projection is idempotent: running it twice with the same document state produces zero
  row changes (verified by a test that asserts `pg_stat` tuple counters do not move on the second
  run).
- `history_events` idempotency comes from the unique key `(board_id, seq, entity_id, kind)`;
  `ON CONFLICT DO NOTHING`.

### 5.4 Conflict and anomaly handling

| Anomaly                                                          | Handling                                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Edge references a node absent from the doc                       | edge is projected with `deleted_at = now()` and a `edge.orphaned` history event; the client's invariant checker removes it from the doc on next load                           |
| Node references a `parent_id` group that does not exist          | `parent_id` set to NULL, `node.reparented` event                                                                                                                               |
| Duplicate `(source,target,type)` from a concurrent offline merge | unique index rejects; the projector soft-deletes the lower-`created_at` loser and records `edge.deduped`. The doc is repaired on the next client load by the invariant checker |
| Node fails zod validation                                        | projected into `nodes` with `type` unchanged and a `validation_error` key in `data._meta`; never dropped (data loss is worse than a bad row)                                   |
| `deleted_at` set in DB but entry present in the doc              | doc wins: `deleted_at` cleared (undo of a delete is exactly this case)                                                                                                         |
| Row present in DB, entry absent in doc, no delete evidence       | left untouched, counted in the consistency check (§5.7); a repeated occurrence triggers a full rebuild for that board                                                          |
| Board schema version newer than the server understands           | projection is skipped, snapshot is still stored, an alert is raised. Never partially project an unknown schema                                                                 |

### 5.5 Backfill and replay

`pnpm db:reproject --board <id> | --project <id> | --all`:

```text
for each board:
  load latest snapshot bytes (current, else newest durable)
  new Y.Doc(); applyUpdateV2(doc, bytes)
  BEGIN;
    DELETE FROM nodes WHERE board_id = b;   -- safe: projection is derived data
    DELETE FROM edges WHERE board_id = b;
    DELETE FROM groups WHERE board_id = b;
    run project() with changed = ALL, history = suppressed
    UPDATE boards SET projection_seq = projection_seq + 1
  COMMIT;
```

Throughput target: 5,000 nodes + 10,000 edges per board in ≤ 4 s (bulk `COPY` into temp tables then
`INSERT … SELECT … ON CONFLICT`), 100 boards per minute, run with `--concurrency 4`.
History events are **not** regenerated on replay (they are the record of what actually happened);
existing ones are preserved because they have no FK to nodes.

### 5.6 Authority rule

If a discrepancy cannot be resolved, **the CRDT wins**. The projection is disposable by
construction: it is rebuilt from snapshots, and no user data exists only in `nodes`/`edges`.
`search_text`, `identity_keys`, `ref_count` and entity resolutions are all recomputable.

### 5.7 Consistency checks

A nightly job (and an on-demand admin action) per board:

| Check                 | Assertion                                                 | Action on failure                                                   |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| C1 count              | `boards.node_count` = live `nodes` rows = doc map size    | re-project the board                                                |
| C2 orphan edges       | no active edge whose endpoint is missing/deleted          | soft-delete + event                                                 |
| C3 parent integrity   | every `parent_id` exists and is a group                   | NULL it + event                                                     |
| C4 group membership   | `group.childIds` ↔ `node.parentId` symmetric             | repair in the doc (origin `system:gc`)                              |
| C5 tag sync           | `node_tags` matches `nodes.data`-level tags               | rebuild node_tags for the board                                     |
| C6 file refs          | `files.ref_count` = actual references                     | recompute                                                           |
| C7 snapshot integrity | `checksum` matches stored bytes; `applyUpdateV2` succeeds | mark snapshot corrupt, fall back to the previous durable one, alert |
| C8 seq monotonic      | `history_events.seq` has no gaps > 1 per board            | log only (gaps are legal when a projection produced no events)      |

Results are written to `audit_logs` with `action = 'consistency.check'`.

---

## 6. Versioning, history and replay

### 6.1 HistoryEvent taxonomy

| kind                                                                    | entity | emitted when                                            | diff content                   |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------------------- | ------------------------------ |
| `node.created`                                                          | node   | node added                                              | full initial payload (capped)  |
| `node.updated`                                                          | node   | any version-bumping field change                        | JSON-pointer diff              |
| `node.moved`                                                            | node   | geometry change (coalesced per 60 s per node per actor) | before/after box               |
| `node.retyped`                                                          | node   | type conversion (`06 §11`)                              | from/to                        |
| `node.archived` / `node.restored`                                       | node   | status change                                           | –                              |
| `node.deleted` / `node.purged`                                          | node   | soft/hard delete                                        | last payload on purge          |
| `node.enriched`                                                         | node   | enrichment reached ready/partial                        | changed fields + tool          |
| `node.merged`                                                           | node   | merge applied                                           | MergePlan summary + member ids |
| `node.unmerged`                                                         | node   | unmerge                                                 | restored ids                   |
| `edge.created` / `edge.updated` / `edge.deleted`                        | edge   | –                                                       | endpoints, type, diff          |
| `edge.rerouted`                                                         | edge   | manual waypoints changed                                | waypoint count before/after    |
| `group.created` / `group.updated` / `group.deleted`                     | group  | –                                                       | –                              |
| `tag.added` / `tag.removed`                                             | node   | –                                                       | tag name                       |
| `comment.created` / `comment.resolved`                                  | board  | –                                                       | comment id                     |
| `board.created` / `board.renamed` / `board.imported` / `board.exported` | board  | –                                                       | counts, format                 |
| `board.snapshot` / `board.restored`                                     | board  | durable snapshot / restore                              | snapshot id                    |
| `proposal.created` / `proposal.accepted` / `proposal.rejected`          | board  | AI or integration proposal                              | proposal id + stats            |
| `run.started` / `run.finished`                                          | board  | integration run touching this board                     | run id, status, counts         |
| `ai.action`                                                             | board  | AI call issued                                          | kind, model, tokens            |
| `share.created` / `share.revoked`                                       | board  | –                                                       | mode, expiry                   |

`actorKind` distinguishes `user` / `tool` / `ai` / `system`, so "what did the machine do to my
board" is a single indexed query.

### 6.2 Diff format

```json
{
  "changes": [
    { "path": "/title", "before": "Old", "after": "New" },
    { "path": "/data/url", "before": null, "after": "https://example.com" },
    { "path": "/tags", "op": "array", "added": ["case/2026"], "removed": [] }
  ],
  "truncated": false
}
```

Values > 2 KB are replaced by `{"__truncated": true, "len": 12345, "sha256": "…"}`. Rich text
fragments are diffed at the **block** level (added/removed/modified block ids with a 200-char
excerpt), never character-by-character — full text history is served by snapshots.

### 6.3 Restore flow

1. User opens History → picks a snapshot (list shows time, actor mix, node/edge counts, label).
2. **Preview**: a read-only board is rendered from the snapshot bytes in a detached `Y.Doc`, with a
   diff overlay: added (green outline), removed (red, ghosted), changed (amber) versus current.
3. Options: `Restore whole board` (creates a checkpoint of the _current_ state first, then applies
   the difference as a single transaction with origin `local:action` ⇒ undoable), or
   `Restore selected nodes` (applies only the chosen entities), or `Open as a new board` (copy).
4. Restoring never deletes snapshots and never rewrites history; it appends `board.restored`.

### 6.4 Node-level diffing

`GET /trpc/history.nodeTimeline?nodeId` returns the ordered `HistoryEvent`s for one entity, which
the inspector renders as a vertical timeline with per-change expanders and a "revert this change"
action that constructs an inverse patch from `before` values (only when the current value still
equals `after`; otherwise it warns about intervening edits).

### 6.5 Investigation replay

Replay animates how the board came to be. Data requirements, all already present:

| Need                        | Source                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| ordered event stream        | `history_events` by `(board_id, seq, created_at)`                          |
| entity geometry at time T   | nearest preceding snapshot + forward-applied `node.moved`/`created` events |
| actor attribution and color | `actor_id`, `actor_kind`                                                   |
| tool context                | `run_id` → `integration_runs` (target, tool, duration)                     |
| proposal context            | `proposal_id` → `ai_proposals.stats`                                       |
| time compression            | events bucketed into 200 frames; buckets with no events are skipped        |
| narration                   | `summary` field of each event, concatenated per bucket                     |

Replay is read-only and never mutates the doc. It requires at least one durable snapshot older than
the replay start; if none exists (board older than retention), replay starts from the oldest
available snapshot and the UI states this explicitly.

---

## 7. Invariants

Checked by `checkGraphInvariants(doc)` on load, after import, after merge, and in tests:

1. Every `edge.source.nodeId` / `edge.target.nodeId` exists in `nodes` (or the edge is deleted).
2. Every `node.parentId` exists in `groups`.
3. `group.data.childIds` ↔ `node.parentId` are symmetric and duplicate-free.
4. `order` contains each live node id exactly once and no unknown ids.
5. Every `fragmentKey` referenced by a node exists in `richtext`, and every fragment has ≤ 1 owner.
6. No two active edges share `(source, target, type, directed)`.
7. Undirected edges satisfy `source.nodeId < target.nodeId`.
8. Every node has a `provenance` object with a valid `kind`.
9. `hypothesis.supportCount`/`contradictCount` equal the count of incident `supports`/`contradicts`.
10. No cycle in `parentId` (groups form a forest, depth ≤ 8).

Repairs run with origin `system:gc`, are excluded from undo, and emit an audit entry listing what
was repaired.

---

## 8. Export and import

### 8.1 `raven.board.v1` — JSON schema

```jsonc
{
  "format": "raven.board.v1",
  "exportedAt": "2026-08-17T12:00:00.000Z",
  "generator": { "app": "raven", "version": "1.4.2", "schemaVersion": 1 },
  "board": {
    "id": "01J9ZC8Q9WQK3M0S9M8J8T1A2B",
    "projectId": "01J9ZC8Q9WQK3M0S9M8J8T1A2C",
    "title": "Case 2026-04 — infrastructure",
    "description": "",
    "background": "dots",
    "defaultEdgeRouting": "smart",
    "tagPalette": { "case/2026-04": "--tag-blue" },
    "savedViews": [],
    "createdAt": "2026-04-02T09:11:00.000Z",
    "updatedAt": "2026-08-17T11:58:12.000Z",
  },
  "nodes": [
    {
      "id": "01J9ZCA0000000000000000001",
      "type": "website",
      "x": 120,
      "y": -40,
      "w": 320,
      "h": 188,
      "z": 3,
      "rotation": 0,
      "parentId": null,
      "locked": false,
      "hidden": false,
      "title": "Example — About",
      "tags": ["case/2026-04"],
      "confidence": "high",
      "color": null,
      "starred": false,
      "status": "active",
      "provenance": {
        "kind": "paste",
        "source": "https://example.com/about",
        "tool": null,
        "runId": null,
        "proposalId": null,
        "rawRef": "raw/01J9.../page.html",
        "observedAt": "2026-04-02T09:12:00.000Z",
        "importedAt": "2026-04-02T09:12:01.000Z",
        "actorId": "01J9ZC8Q9WQK3M0S9M8J8T1A2A",
      },
      "enrichment": {
        "state": "ready",
        "jobId": null,
        "attempts": 1,
        "lastError": null,
        "updatedAt": "2026-04-02T09:12:09.000Z",
      },
      "version": 4,
      "createdAt": "2026-04-02T09:12:00.000Z",
      "updatedAt": "2026-04-02T09:12:09.000Z",
      "data": {
        "url": "https://example.com/about",
        "canonicalUrl": "https://example.com/about",
        "siteName": "Example",
        "description": "About the company",
        "faviconFileId": "01J9ZCF0000000000000000009",
        "screenshotFileId": null,
        "ogImageFileId": null,
        "httpStatus": 200,
        "finalUrl": "https://example.com/about",
        "contentType": "text/html",
        "lang": "en",
        "publishedAt": null,
        "author": null,
        "excerpt": "Example is a company…",
        "archiveUrl": null,
        "notes": null,
      },
    },
  ],
  "edges": [
    {
      "id": "01J9ZCB0000000000000000001",
      "type": "hosted_on",
      "source": {
        "nodeId": "01J9ZCA0000000000000000001",
        "port": "auto",
        "offset": 0.5,
        "anchorKey": null,
      },
      "target": {
        "nodeId": "01J9ZCA0000000000000000002",
        "port": "auto",
        "offset": 0.5,
        "anchorKey": null,
      },
      "directed": true,
      "label": "",
      "description": null,
      "confidence": "medium",
      "weight": 0.5,
      "observedAt": "2026-04-02T09:20:00.000Z",
      "validFrom": null,
      "validTo": null,
      "tags": [],
      "waypoints": [],
      "manualRoute": false,
      "style": {
        "routing": null,
        "stroke": null,
        "width": null,
        "dash": null,
        "arrowSource": null,
        "arrowTarget": null,
        "animated": null,
        "labelPosition": 0.5,
        "labelOffset": { "dx": 0, "dy": 0 },
        "curvature": null,
        "cornerRadius": null,
        "zBias": 0,
      },
      "locked": false,
      "hidden": false,
      "status": "active",
      "provenance": {
        "kind": "manual",
        "source": null,
        "tool": null,
        "runId": null,
        "proposalId": null,
        "rawRef": null,
        "observedAt": "2026-04-02T09:20:00.000Z",
        "importedAt": "2026-04-02T09:20:00.000Z",
        "actorId": "01J9ZC8Q9WQK3M0S9M8J8T1A2A",
      },
      "version": 1,
      "createdAt": "2026-04-02T09:20:00.000Z",
      "updatedAt": "2026-04-02T09:20:00.000Z",
      "data": {},
    },
  ],
  "groups": [
    {
      "id": "01J9ZCC0000000000000000001",
      "kind": "frame",
      "label": "Infrastructure",
      "x": 0,
      "y": -120,
      "w": 900,
      "h": 640,
      "collapsed": false,
      "parentId": null,
      "padding": 24,
      "background": null,
      "childIds": ["01J9ZCA0000000000000000001"],
      "autoLayout": "none",
      "version": 1,
      "createdAt": "2026-04-02T09:10:00.000Z",
      "updatedAt": "2026-04-02T09:10:00.000Z",
    },
  ],
  "richtext": {
    "fk_01J9ZCD0000000000000000001": {
      "encoding": "prosemirror-json",
      "doc": {
        "type": "doc",
        "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Notes." }] }],
      },
    },
  },
  "order": ["01J9ZCC0000000000000000001", "01J9ZCA0000000000000000001"],
  "files": [
    {
      "id": "01J9ZCF0000000000000000009",
      "name": "favicon.ico",
      "mime": "image/x-icon",
      "size": 4286,
      "sha256": "e3b0c442…",
      "path": "files/01J9ZCF0000000000000000009/original.ico",
      "metadata": { "width": 32, "height": 32 },
    },
  ],
  "comments": [],
  "extensions": {},
}
```

Rules:

- `files[].path` is present only inside a project archive (§8.4); a bare JSON export sets
  `"path": null` and the importer resolves the file by `sha256` against the target project, or marks
  the node's media as `missing` with a repair prompt.
- `extensions` is an escape hatch for plugin data (`17_PLUGIN_SDK.md` §6): a map keyed by plugin id.
  Importers preserve unknown keys verbatim.
- Rich text is exported as **ProseMirror JSON**, not as a Yjs update: portable, diffable, and
  reconstructible into a `Y.XmlFragment` deterministically.
- A JSON Schema (draft 2020-12) for this format is generated from the zod schemas and published at
  `packages/domain/schemas/raven.board.v1.json`; the exporter validates against it before writing.

### 8.2 Round-trip guarantee (N9)

`import(export(board))` must produce a `Y.Doc` that is **deep-equal** to the original for every key
listed in §2.2, ignoring only: `meta.updatedAt`, and the CRDT's internal client ids/clocks.
Enforced by a property test (`packages/domain/test/roundtrip.prop.spec.ts`) using fast-check to
generate boards with 1–400 nodes across all registered types, all edge types, nested groups, rich
text with every supported mark/block, and unknown/plugin node types.

Import modes:

| Mode         | Ids                                                                                                          | Use                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `restore`    | keep original ids                                                                                            | re-importing a board that no longer exists     |
| `copy`       | remap all ids (ULID regenerated, references rewritten via a temp-id map)                                     | duplicating a board                            |
| `merge-into` | remap, unless a node with the same `identityKeys` exists in the target and the user chose "merge duplicates" | adding an investigation into an existing board |

Import is a single transaction with origin `system:import`, preceded by an automatic checkpoint
snapshot, so it is reversible with one action.

### 8.3 CSV mappings

Three CSVs, UTF-8 with BOM, RFC 4180, `\r\n`, ISO-8601 timestamps in UTC.

`nodes.csv`:
`id, type, title, tags, confidence, status, x, y, w, h, parent_id, created_at, updated_at,
provenance_kind, provenance_source, provenance_tool, provenance_observed_at, primary_value, summary,
<type-specific columns from def.io.csvColumns>`

`primary_value` is the type's identifying string (`url`, `handle`, `address`, `name`, …) so a
spreadsheet user gets a usable column without knowing the type system.

`edges.csv`:
`id, type, source_id, source_title, target_id, target_title, directed, label, confidence, weight,
observed_at, valid_from, valid_to, provenance_kind, provenance_tool`

`tags.csv`: `tag, node_count, color`

CSV **import** supports `nodes.csv` + `edges.csv` with a column-mapping dialog; unmapped columns land
in `data._imported.<column>`. CSV import is explicitly lossy (no rich text, no geometry precision
beyond the columns present) and the dialog says so.

### 8.4 Markdown export

Per board, one file plus an assets folder:

```markdown
# Case 2026-04 — infrastructure

> Exported 2026-08-17 12:00 UTC · 128 nodes · 214 edges · Raven 1.4.2

## Summary

<board description>

## Entities

### Websites

#### Example — About `high`

- URL: https://example.com/about
- Tags: `case/2026-04`
- Source: pasted by A. Analyst on 2026-04-02 09:12 UTC
- Notes: …

### Identities

…

## Relationships

| From            | Relationship | To           | Confidence | Observed   |
| --------------- | ------------ | ------------ | ---------- | ---------- |
| Example — About | hosted on    | 203.0.113.10 | medium     | 2026-04-02 |

## Evidence

…

## Hypotheses

- **[open]** The two accounts belong to one operator — supported by 3, contradicted by 1

## Timeline

- 2026-04-02 09:12 — website captured
  …

## Appendix: provenance

| Node | Tool | Run | Observed |
```

Grouping is by node type, ordered by the registry's declaration order; within a type, by `title`.
Images are written to `assets/` and referenced relatively. Markdown export is one-way (documented).

### 8.5 Project archive (`.raven.zip`)

```text
manifest.json                 { format: "raven.project.v1", exportedAt, generator,
                                project: {...}, boards: [{id, title, file, nodeCount, edgeCount}],
                                files: [{id, sha256, size, path}], counts, checksum: sha256 of
                                a canonical listing of all member checksums }
project.json                  project metadata, tags, saved searches, watchlists (no secrets)
boards/<boardId>.json         one raven.board.v1 document per board
boards/<boardId>.ydoc         optional: raw Y.Doc update (V2) for exact CRDT restore
files/<fileId>/original.<ext> file bytes
files/<fileId>/meta.json      File row fields (name, mime, size, sha256, metadata)
runs/<runId>.json             integration run records (redactable)
runs/<runId>/raw.json(.gz)    raw tool payloads (redactable)
history/<boardId>.ndjson      history events (redactable)
README.md                     human-readable index, generated
```

Options at export time: include files (default on), include raw tool payloads (default on), include
history (default on), strip EXIF from images (default **on** for share exports, off for archival
backups), redact provenance actor names (default off). Every option is recorded in `manifest.json`
so an importer knows what is missing.

Integrity: `manifest.checksum` over the sorted list of `path:sha256`; the importer verifies each
file and refuses partial archives unless `--allow-partial` is given, in which case missing files
become `missing` media with a repair prompt.

### 8.6 Schema migration strategy

- `format` string carries the major version (`raven.board.v1`). `generator.schemaVersion` carries the
  document schema version (`meta.schemaVersion`).
- Migrations live in `packages/domain/src/migrations/` as
  `{ from: 1, to: 2, migrateDoc(doc), migrateExport(json) }` and are **forward-only**, pure and
  idempotent. The runner applies them in order until `to === CURRENT`.
- On board load: if `meta.schemaVersion < CURRENT`, a `pre-migration` snapshot is written, the
  migration runs in one transaction with origin `system:migration`, and `meta.lastMigratedAt` is set.
  Clients older than the document's version refuse to open it read-write and offer read-only mode
  (they can still render because unknown keys are preserved).
- On import: `migrateExport` runs on the JSON before it is converted into a doc, so old archives keep
  importing forever. Every migration ships with a fixture archive of the old version in
  `packages/domain/test/fixtures/archives/` and a test asserting the migrated result.
- Postgres migrations are Prisma migrations, additive-first: add column → backfill in a job →
  switch reads → drop in a later release. No destructive migration ships in the same release as the
  code that stops using the column (`19_DEPLOYMENT.md` §5).

---

## 9. Open risks

1. **Diffing a Yjs update to compute the changed key set** (§5.2) depends on decoding update
   internals. If that proves fragile across Yjs versions, the fallback is a full-document projection
   per cycle (measured at ~180 ms for a 5k/10k board) — correct but heavier. The code must implement
   the fallback path from day one and select it by a config flag, so a Yjs upgrade can never break
   persistence.
2. **GC vs history.** Enabling Yjs GC means we cannot reconstruct arbitrary past states from the
   live document; we depend on snapshot cadence. A board edited heavily for 20 minutes with no
   durable snapshot could lose fine-grained replay resolution for that window. Cadence (§2.8) is
   tuned for this, but it is a real trade-off, not a solved problem.
3. **ULID as `CHAR(26)`** costs ~10 bytes per key versus binary uuidv7, multiplied across
   `edges` (10k/board) and `history_events`. Accepted for offline generation and debuggability; if
   storage becomes a problem the domain type can move to `BYTEA(16)` with an application-level codec
   without changing any application code, since ids are opaque strings in TypeScript.
4. **RLS does not cover project/board ACL**, only tenant. A bug in the authorization layer can still
   expose a board to another member of the same organization. Mitigated by explicit authorization
   tests per tRPC procedure (`18_TESTING.md` §6), not by the database.
5. **Hash partitioning `nodes`/`edges` by `board_id`** makes cross-board queries (global search,
   entity resolution across boards) fan out to 16 partitions. Measured acceptable at the target
   scale; if global search becomes the dominant workload, the fix is a dedicated denormalized
   `search_documents` table maintained by the projector rather than de-partitioning.
6. **pgvector dimension lock-in** (1536). Switching embedding models with a different dimension
   requires a new table and a re-embedding backfill; `content_hash` makes the backfill resumable but
   it is still an O(corpus) job.
7. **Comments as a subdoc** means comment permissions are enforced at the sync layer, not by RLS on
   a Postgres row the client reads directly. The projection of comments into Postgres is therefore
   authoritative for notifications and export, and the subdoc must be treated as untrusted input by
   the projector (validated with zod, same as everything else).
