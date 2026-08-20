# Runbook: `SyncBroadcastSlow`

**Alert**: `histogram_quantile(0.95, raven_sync_broadcast_latency_seconds) > 1` for 10m, severity
**ticket**.

## What it means

The p95 time between the sync service receiving an update and broadcasting it to other clients in
the same room (`apps/sync/src/server.ts`'s `onChange`) has exceeded 1s — well above the ≤ 250ms p95
performance target (P8 §10). Collaborators see each other's edits with a visible lag; nothing is
lost (N2 still holds — local writes are durable regardless of broadcast speed).

## Three most likely causes

1. Redis fanout latency (the `@hocuspocus/extension-redis` pub/sub hop) — check Redis CPU/memory
   and network RTT between sync pods and Redis.
2. A hot room: one board with an unusually large number of concurrent connections is monopolizing
   an event-loop tick. Check `raven_sync_connections` and `raven_sync_awareness_clients` for an
   outlier board.
3. `raven_sync_rooms_open` is near the per-pod budget (120, `19_DEPLOYMENT.md` §13) and the pod is
   CPU-bound across many rooms, not one.

## First diagnostic query

```promql
topk(5, raven_sync_connections)
```

against the sync service's own `/metrics`, plus `redis-cli --latency` from a sync pod.

## Mitigation

- Hot single room: nothing to do server-side beyond waiting it out; if it recurs, this board is a
  candidate for the (future) per-board sharding discussed in `19_DEPLOYMENT.md` §13 growth
  triggers.
- Fleet-wide slowness: scale `sync` horizontally (HPA target is `raven_sync_rooms_open` at 120/pod)
  or scale Redis.

## Escalation

Ticket to the backend on-call; page only if it correlates with `SyncMemoryHigh` or a Redis outage.
