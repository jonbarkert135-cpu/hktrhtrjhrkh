# Runbook: `SyncProjectionFailing`

**Alert**: `rate(raven_sync_projection_failures_total[5m]) > 0` for 5m, severity **page**.

## What it means

The sync service's `onStoreDocument` hook (`apps/sync/src/projection.ts`'s `projectBoard`) is
failing to write the `nodes`/`edges` rows for at least one board after its retries
(`DEFAULT_RETRY_POLICY`: 1s, 5s, 15s). The Y.Doc snapshot binary is still committed — no user data
is at risk (`08_DATA_MODEL.md` §5.6, the CRDT is authoritative) — but search, exports and
integrations reading the Postgres projection for that board will be stale or missing rows.

## Three most likely causes

1. A Postgres connectivity/pool exhaustion issue (check `raven_db_pool_in_use` alongside this
   alert — if it is also high, this is a symptom, not the cause).
2. A schema drift: a board's node/edge payload fails the zod parse in
   `packages/domain/src/projection/diffDoc.ts` and is silently skipped rather than upserted
   (08 §5.4 "Node fails zod validation" — check for a spike in skipped rows, which by design does
   not itself raise this alert; a _thrown_ error from the Prisma writer is what does).
3. A Prisma migration is pending (`raven_migration_pending == 1`) and the `nodes`/`edges` table
   shape no longer matches `packages/db/prisma/schema.prisma`.

## First diagnostic query

```sql
select id, title, last_projected_at, last_edited_at, projection_failed
from boards
where projection_failed = true
order by last_edited_at desc
limit 20;
```

Cross-reference with sync service logs for `event: "sync.projection.failed"` (structured, includes
`board_id` and `reason`).

## Mitigation

- If it is one or two boards: run `pnpm --filter @nexus/db exec tsx scripts/reproject.ts --board
<id>` once the underlying cause (2) or (3) above is fixed — replay is idempotent and safe to
  re-run.
- If it is many boards at once: treat as an incident on the shared cause (Postgres/Redis), fix that
  first, then run `--all` reprojection with `--concurrency 4` (08 §5.5 throughput target: 100
  boards/minute).

## Escalation

Page the on-call backend engineer. If the root cause is a schema mismatch introduced by a recent
deploy, roll back the sync service image first — the projection catches up automatically once
`onStoreDocument` succeeds on the next debounce cycle.
