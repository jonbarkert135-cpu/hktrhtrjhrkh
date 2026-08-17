/**
 * Board document construction (08_DATA_MODEL.md §2.1). The doc is created empty and seeded with
 * `meta` in one `system:migration` transaction, so seeding never lands on the undo stack.
 */

import * as Y from 'yjs';

import { BoardMetaSchema, type BoardMeta } from '../entities/group.ts';
import { CURRENT_SCHEMA_VERSION, boardDocGuid, initBoardDoc } from './schema.ts';
import { tx } from './transactions.ts';

export interface CreateBoardDocOptions {
  boardId: string;
  projectId?: string | null;
  title?: string;
  /** ISO timestamp used for `meta.createdAt`/`updatedAt`; injected so tests stay deterministic. */
  now: string;
  /** Yjs GC is on for live docs (08 §2.8); tests that inspect deleted structs turn it off. */
  gc?: boolean;
}

export function createBoardDoc(options: CreateBoardDocOptions): Y.Doc {
  const doc = new Y.Doc({ guid: boardDocGuid(options.boardId), gc: options.gc ?? true });
  const roots = initBoardDoc(doc);
  const meta = BoardMetaSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    boardId: options.boardId,
    projectId: options.projectId ?? null,
    title: options.title ?? 'Untitled board',
    createdAt: options.now,
    updatedAt: options.now,
  });

  tx(doc, 'system:migration', () => {
    for (const [key, value] of Object.entries(meta)) roots.meta.set(key, value);
  });

  return doc;
}

/** An empty doc with the eight roots materialised but no `meta` — used when loading from storage. */
export function emptyBoardDoc(boardId: string, gc = true): Y.Doc {
  const doc = new Y.Doc({ guid: boardDocGuid(boardId), gc });
  initBoardDoc(doc);
  return doc;
}

export function readMeta(doc: Y.Doc): BoardMeta | undefined {
  const raw = initBoardDoc(doc).meta.toJSON();
  const parsed = BoardMetaSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
