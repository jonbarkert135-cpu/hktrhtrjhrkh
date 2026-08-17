/**
 * The single sanctioned way to mutate a board document (08_DATA_MODEL.md §2.4).
 *
 * `doc.transact` is never called anywhere else — the `no-direct-graph-write` ESLint rule enforces
 * that outside `packages/domain/src/doc`. One user gesture is one transaction, which makes it one
 * undo step and (from P8) one projection batch.
 */

import type * as Y from 'yjs';

export const LOCAL_ORIGINS = [
  'local:create',
  'local:edit',
  'local:move',
  'local:delete',
  'local:action',
  'local:paste',
  'local:layout',
  'local:merge',
  'local:proposal-apply',
] as const;

export const NON_LOCAL_ORIGINS = [
  'remote:sync',
  'remote:enrich',
  'remote:projection-repair',
  'system:migration',
  'system:gc',
  'system:import',
] as const;

export type LocalOrigin = (typeof LOCAL_ORIGINS)[number];
export type NonLocalOrigin = (typeof NON_LOCAL_ORIGINS)[number];
export type Origin = LocalOrigin | NonLocalOrigin;

const LOCAL_SET: ReadonlySet<string> = new Set<string>(LOCAL_ORIGINS);

/** True for origins the local user caused, i.e. the ones the UndoManager tracks. */
export function isLocalOrigin(origin: unknown): origin is LocalOrigin {
  return typeof origin === 'string' && LOCAL_SET.has(origin);
}

/** Runs `fn` inside one Yjs transaction tagged with `origin`. */
export function tx<T>(doc: Y.Doc, origin: Origin, fn: (t: Y.Transaction) => T): T {
  return doc.transact(fn, origin);
}
