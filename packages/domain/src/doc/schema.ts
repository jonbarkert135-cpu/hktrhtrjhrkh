/**
 * The board document schema (08_DATA_MODEL.md §2.2). One `Y.Doc` per board, `guid = board:<id>`.
 *
 * There are exactly eight top-level keys; adding a ninth is a document-format migration (§8.6).
 * Everything in this file is pure Yjs: the domain package never imports the canvas engine, React
 * or any storage provider.
 */

import type * as Y from 'yjs';

/** Current document schema version stored in `meta.schemaVersion`. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Soft/hard limits from 08_DATA_MODEL.md §2.6, enforced by `assertCanCreateNodes`. */
export const NODE_SOFT_LIMIT = 4_000;
export const NODE_HARD_LIMIT = 20_000;

export const BOARD_DOC_KEYS = [
  'meta',
  'nodes',
  'edges',
  'groups',
  'richtext',
  'comments',
  'order',
  'assets',
] as const;

export type BoardDocKey = (typeof BOARD_DOC_KEYS)[number];

/** A node/edge/group record inside the CRDT: a `Y.Map` of plain, JSON-serialisable values. */
export type EntityMap = Y.Map<unknown>;

/** Typed accessors so no caller has to remember the key names or the generic parameters. */
export interface BoardDocRoots {
  meta: Y.Map<unknown>;
  nodes: Y.Map<EntityMap>;
  edges: Y.Map<EntityMap>;
  groups: Y.Map<EntityMap>;
  richtext: Y.Map<Y.XmlFragment>;
  comments: Y.Map<EntityMap>;
  order: Y.Array<string>;
  assets: Y.Map<EntityMap>;
}

/** Materialises the eight root types on `doc`. Idempotent — `getMap` creates only once. */
export function initBoardDoc(doc: Y.Doc): BoardDocRoots {
  return {
    meta: doc.getMap<unknown>('meta'),
    nodes: doc.getMap<EntityMap>('nodes'),
    edges: doc.getMap<EntityMap>('edges'),
    groups: doc.getMap<EntityMap>('groups'),
    richtext: doc.getMap<Y.XmlFragment>('richtext'),
    comments: doc.getMap<EntityMap>('comments'),
    order: doc.getArray<string>('order'),
    assets: doc.getMap<EntityMap>('assets'),
  };
}

/** Same as `initBoardDoc`, named for call sites that only read. */
export function boardRoots(doc: Y.Doc): BoardDocRoots {
  return initBoardDoc(doc);
}

/** `board:<boardId>` — also the Hocuspocus room name in P8 (08 §2.1). */
export function boardDocGuid(boardId: string): string {
  return `board:${boardId}`;
}

/**
 * The undo scope (08 §2.5): content plus meta, deliberately excluding `comments` so undoing a
 * canvas edit can never delete a colleague's comment.
 */
export function undoScope(doc: Y.Doc): Array<Y.AbstractType<unknown>> {
  const roots = boardRoots(doc);
  return [
    roots.nodes as unknown as Y.AbstractType<unknown>,
    roots.edges as unknown as Y.AbstractType<unknown>,
    roots.groups as unknown as Y.AbstractType<unknown>,
    roots.richtext as unknown as Y.AbstractType<unknown>,
    roots.order as unknown as Y.AbstractType<unknown>,
    roots.meta as unknown as Y.AbstractType<unknown>,
  ];
}

/** Deep-converts a `Y.Map` record into plain JSON, preserving unknown keys (08 §2.2.2). */
export function entityToJson(map: EntityMap): Record<string, unknown> {
  return map.toJSON();
}
