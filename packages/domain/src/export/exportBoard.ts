/**
 * `exportBoard(doc) → BoardExportV1` (P3 §5.11). Deterministic by construction: arrays are sorted
 * by id, object keys are emitted in schema order and `stableStringify` sorts the rest, so the same
 * document always produces the same bytes.
 */

import type * as Y from 'yjs';

import { readMeta } from '../doc/createBoardDoc.ts';
import { listEdges, listGroups, listNodes } from '../doc/mutations.ts';
import { CURRENT_SCHEMA_VERSION, boardRoots } from '../doc/schema.ts';
import { AssetSchema } from '../entities/group.ts';
import { fragmentToJson, type RichTextDocJson } from './richtext.ts';
import {
  BOARD_EXPORT_FORMAT,
  BoardExportV1Schema,
  stableStringify,
  type BoardExportV1,
  type FileManifest,
} from './schema.v1.ts';

export interface ExportOptions {
  /** App version written into `generator`; injected so exports stay reproducible in tests. */
  appVersion: string;
  /** ISO timestamp for `exportedAt`. */
  now: string;
}

export function exportBoard(doc: Y.Doc, options: ExportOptions): BoardExportV1 {
  const roots = boardRoots(doc);
  const meta = readMeta(doc);
  if (meta === undefined) {
    throw new Error('exportBoard: the document has no valid meta; is it a board document?');
  }

  const richtext: Record<string, RichTextDocJson> = {};
  for (const key of [...roots.richtext.keys()].sort()) {
    const fragment = roots.richtext.get(key);
    if (fragment !== undefined) richtext[key] = fragmentToJson(fragment);
  }

  const files: FileManifest[] = [];
  roots.assets.forEach((map) => {
    const parsed = AssetSchema.safeParse(map.toJSON());
    if (!parsed.success) return;
    const { createdAt: _createdAt, ...rest } = parsed.data;
    files.push({ ...rest, path: null, metadata: {} });
  });
  files.sort((a, b) => a.id.localeCompare(b.id));

  return BoardExportV1Schema.parse({
    format: BOARD_EXPORT_FORMAT,
    exportedAt: options.now,
    generator: {
      app: 'nexus',
      version: options.appVersion,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    },
    board: meta,
    nodes: listNodes(doc),
    edges: listEdges(doc),
    groups: listGroups(doc),
    richtext,
    order: roots.order.toArray(),
    files,
    comments: [],
    extensions: {},
  });
}

/** The bytes written to `<board title>.nexus.json`. */
export function serializeBoardExport(value: BoardExportV1): string {
  return stableStringify(value);
}
