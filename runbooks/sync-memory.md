# Runbook: `SyncMemoryHigh`

**Alert**: `raven_sync_doc_memory_bytes > 1.5e9`, severity **ticket**.

## What it means

The sync service's estimated resident memory for open `Y.Doc` rooms is approaching the 2 GB pod
limit (`19_DEPLOYMENT.md` §13: budget ~80 MB per large board, ~20 concurrently open large boards
per pod). Left unaddressed, the pod risks an OOM kill, which would drop every client connected to
that pod (they reconnect elsewhere — P8 §7 graceful degradation — but with a latency spike).

## Three most likely causes

1. Idle eviction (`apps/sync/src/eviction.ts`'s `RoomEvictionTracker`, 60s timeout) is not firing —
   check for rooms with zero connections that are still resident (`isPendingEviction` should be
   true for them; if a room shows zero connections and no pending eviction, the tracker missed a
   disconnect event).
2. A genuine spike in concurrently open large boards on one pod (more than the ~20-large-board
   budget) — check `raven_sync_rooms_open` against the HPA target of 120 (which assumes typical,
   not large, boards).
3. A memory leak: Yjs document history (undo stack) growing unbounded for a board with pathological
   edit patterns — check whether the same `board_id` keeps recurring in logs across restarts.

## First diagnostic query

Compare `raven_sync_rooms_open` (count) against `raven_sync_doc_memory_bytes` (bytes) — a high
ratio of the latter to the former points at a few outsized boards, not many typical ones.

## Mitigation

- Force-evict idle rooms: none should be resident with zero connections for more than 60s: verify
  the tracker's timers are running (a stuck event loop would explain both this and
  `SyncBroadcastSlow` together).
- Scale `sync` horizontally so large boards spread across more pods.
- If a single board's memory is pathological, it is a candidate for the (future) history-compaction
  work in `08_DATA_MODEL.md` §2.8 (Yjs GC) — check `gc: true` is in effect for it.

## Escalation

Ticket, not page, unless combined with `raven_sync_rooms_open` also breaching its budget, which
elevates this to imminent-OOM and should page.
