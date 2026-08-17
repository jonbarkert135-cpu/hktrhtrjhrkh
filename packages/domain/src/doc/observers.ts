/**
 * Document → view bridge (P3 §7). Yjs events are translated into a *changed-ids* summary with
 * O(changed) work, never a full scan: the canvas binding turns that summary into engine patches, so
 * a 200-node move costs one patch, not a scene rebuild.
 */

import type * as Y from 'yjs';

import { boardRoots } from './schema.ts';

export interface BoardChange {
  /** Ids created or modified since the last event, in insertion order. */
  readonly nodes: { readonly upserted: readonly string[]; readonly removed: readonly string[] };
  readonly edges: { readonly upserted: readonly string[]; readonly removed: readonly string[] };
  readonly groups: { readonly upserted: readonly string[]; readonly removed: readonly string[] };
  readonly orderChanged: boolean;
  readonly metaChanged: boolean;
  /** The transaction origin (08 §2.4); `undefined` for updates applied without one. */
  readonly origin: unknown;
  /** True when the change came from another client/provider rather than this session. */
  readonly remote: boolean;
}

type Bucket = { upserted: Set<string>; removed: Set<string> };

const emptyBucket = (): Bucket => ({ upserted: new Set(), removed: new Set() });

function collect(
  events: readonly Y.YEvent<Y.AbstractType<unknown>>[],
  root: Y.Map<unknown>,
): Bucket {
  const bucket = emptyBucket();
  for (const event of events) {
    if (event.target === root) {
      for (const [key, change] of event.changes.keys) {
        if (change.action === 'delete') {
          bucket.removed.add(key);
          bucket.upserted.delete(key);
        } else {
          bucket.upserted.add(key);
        }
      }
      continue;
    }
    // A nested change inside one record: `path[0]` is that record's id.
    const id = event.path[0];
    if (typeof id === 'string' && !bucket.removed.has(id)) bucket.upserted.add(id);
  }
  return bucket;
}

const toChange = (bucket: Bucket): BoardChange['nodes'] => ({
  upserted: [...bucket.upserted],
  removed: [...bucket.removed],
});

const isEmpty = (bucket: Bucket): boolean =>
  bucket.upserted.size === 0 && bucket.removed.size === 0;

/**
 * Subscribes to every content root and emits one `BoardChange` per transaction.
 * Returns an unsubscribe function; calling it twice is safe.
 */
export function observeBoard(doc: Y.Doc, listener: (change: BoardChange) => void): () => void {
  const roots = boardRoots(doc);

  let pending: {
    nodes: Bucket;
    edges: Bucket;
    groups: Bucket;
    orderChanged: boolean;
    metaChanged: boolean;
  } | null = null;

  const ensure = (): NonNullable<typeof pending> => {
    pending ??= {
      nodes: emptyBucket(),
      edges: emptyBucket(),
      groups: emptyBucket(),
      orderChanged: false,
      metaChanged: false,
    };
    return pending;
  };

  const merge = (into: Bucket, from: Bucket): void => {
    for (const id of from.removed) {
      into.removed.add(id);
      into.upserted.delete(id);
    }
    for (const id of from.upserted) if (!into.removed.has(id)) into.upserted.add(id);
  };

  const onNodes = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    merge(ensure().nodes, collect(events, roots.nodes as unknown as Y.Map<unknown>));
  };
  const onEdges = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    merge(ensure().edges, collect(events, roots.edges as unknown as Y.Map<unknown>));
  };
  const onGroups = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    merge(ensure().groups, collect(events, roots.groups as unknown as Y.Map<unknown>));
  };
  const onOrder = (): void => {
    ensure().orderChanged = true;
  };
  const onMeta = (): void => {
    ensure().metaChanged = true;
  };

  const onAfter = (transaction: Y.Transaction): void => {
    const batch = pending;
    pending = null;
    if (batch === null) return;
    if (
      isEmpty(batch.nodes) &&
      isEmpty(batch.edges) &&
      isEmpty(batch.groups) &&
      !batch.orderChanged &&
      !batch.metaChanged
    ) {
      return;
    }
    listener({
      nodes: toChange(batch.nodes),
      edges: toChange(batch.edges),
      groups: toChange(batch.groups),
      orderChanged: batch.orderChanged,
      metaChanged: batch.metaChanged,
      origin: transaction.origin,
      remote: !transaction.local,
    });
  };

  roots.nodes.observeDeep(onNodes);
  roots.edges.observeDeep(onEdges);
  roots.groups.observeDeep(onGroups);
  roots.order.observe(onOrder);
  roots.meta.observe(onMeta);
  doc.on('afterTransaction', onAfter);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    roots.nodes.unobserveDeep(onNodes);
    roots.edges.unobserveDeep(onEdges);
    roots.groups.unobserveDeep(onGroups);
    roots.order.unobserve(onOrder);
    roots.meta.unobserve(onMeta);
    doc.off('afterTransaction', onAfter);
  };
}
