/**
 * `importBoard(json)` (P3 §5.12): validate → migrate → remap ids → apply in ONE transaction with
 * origin `system:import`, and return a report the confirm dialog can show. Nothing touches the
 * document before validation succeeds, so a malformed file can never half-import (P3 §9).
 */

import * as Y from 'yjs';

import { createBoardDoc } from '../doc/createBoardDoc.ts';
import { migrateExportJson } from '../doc/migrations.ts';
import { pruneDanglingEdges, repairOrder } from '../doc/mutations.ts';
import { CURRENT_SCHEMA_VERSION, boardRoots } from '../doc/schema.ts';
import { tx } from '../doc/transactions.ts';
import { applyJsonToFragment } from './richtext.ts';
import { BoardExportV1Schema, IMPORT_NODE_LIMIT, type BoardExportV1 } from './schema.v1.ts';

export type ImportMode = 'restore' | 'copy' | 'merge-into';

export interface ImportOptions {
  /** `restore` keeps ids, `copy` remaps them, `merge-into` remaps into an existing document. */
  mode: ImportMode;
  /** Target document for `merge-into`; a fresh doc is created for the other modes. */
  into?: Y.Doc;
  /** Id factory — injected so tests get deterministic ids. */
  newId: () => string;
  now: string;
}

export interface ImportReport {
  created: { nodes: number; edges: number; groups: number; fragments: number };
  skipped: { nodes: number; edges: number };
  remapped: number;
  warnings: string[];
  migrations: string[];
}

export interface ImportResult {
  doc: Y.Doc;
  report: ImportReport;
}

export class ImportError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'ImportError';
    this.issues = issues;
  }
}

/** Validates and migrates without mutating anything — the dialog's "what will happen" step. */
export function parseBoardExport(input: unknown): { data: BoardExportV1; migrations: string[] } {
  if (typeof input !== 'object' || input === null) {
    throw new ImportError('This file is not a Raven board export.');
  }
  const { json, applied } = migrateExportJson(input as Record<string, unknown>);
  const nodes = json.nodes;
  if (Array.isArray(nodes) && nodes.length > IMPORT_NODE_LIMIT) {
    throw new ImportError(
      `This file contains ${String(nodes.length)} nodes; the limit for one board is ${String(IMPORT_NODE_LIMIT)}. Split it into several boards first.`,
    );
  }
  const parsed = BoardExportV1Schema.safeParse(json);
  if (!parsed.success) {
    throw new ImportError(
      'This board export is not valid and was not imported.',
      parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return { data: parsed.data, migrations: applied };
}

function toMap(record: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(record)) map.set(key, value);
  return map;
}

export function importBoard(input: unknown, options: ImportOptions): ImportResult {
  const { data, migrations } = parseBoardExport(input);
  const target =
    options.into ??
    createBoardDoc({
      boardId: options.mode === 'restore' ? data.board.boardId : options.newId(),
      projectId: data.board.projectId,
      title: data.board.title,
      now: options.now,
    });
  const roots = boardRoots(target);

  const warnings: string[] = [];
  const remap = new Map<string, string>();
  const keepIds = options.mode === 'restore' && options.into === undefined;
  const idFor = (id: string): string => {
    if (keepIds) return id;
    const existing = remap.get(id);
    if (existing !== undefined) return existing;
    // Only collide-free ids are remapped in `copy`; `merge-into` always remaps to stay safe.
    const next =
      options.mode === 'copy' || roots.nodes.has(id) || roots.groups.has(id) || roots.edges.has(id)
        ? options.newId()
        : id;
    remap.set(id, next);
    return next;
  };

  const report: ImportReport = {
    created: { nodes: 0, edges: 0, groups: 0, fragments: 0 },
    skipped: { nodes: 0, edges: 0 },
    remapped: 0,
    warnings,
    migrations,
  };

  const fileIds = new Set(data.files.map((file) => file.id));

  tx(target, 'system:import', () => {
    if (options.into === undefined) {
      for (const [key, value] of Object.entries(data.board)) roots.meta.set(key, value);
      roots.meta.set('schemaVersion', CURRENT_SCHEMA_VERSION);
      if (!keepIds) roots.meta.set('boardId', target.guid.replace(/^board:/, ''));
    }

    for (const node of data.nodes) {
      const id = idFor(node.id);
      if (roots.nodes.has(id)) {
        report.skipped.nodes += 1;
        continue;
      }
      const parentId = node.parentId === null ? null : idFor(node.parentId);
      const fragmentKey = node.data.fragmentKey;
      const data0: Record<string, unknown> = { ...node.data };
      if (typeof fragmentKey === 'string') data0.fragmentKey = idFor(fragmentKey);
      const fileId = node.data.fileId;
      if (typeof fileId === 'string' && !fileIds.has(fileId)) {
        data0.fileState = 'missing';
        warnings.push(`Node "${node.title || id}" references a file that is not in this archive.`);
      }
      roots.nodes.set(id, toMap({ ...node, id, parentId, data: data0 }));
      report.created.nodes += 1;
    }

    for (const group of data.groups) {
      const id = idFor(group.id);
      if (roots.groups.has(id)) continue;
      roots.groups.set(
        id,
        toMap({
          ...group,
          id,
          parentId: group.parentId === null ? null : idFor(group.parentId),
          childIds: group.childIds.map(idFor),
        }),
      );
      report.created.groups += 1;
    }

    for (const edge of data.edges) {
      const id = idFor(edge.id);
      const from = idFor(edge.source.nodeId);
      const to = idFor(edge.target.nodeId);
      if (!roots.nodes.has(from) || !roots.nodes.has(to)) {
        report.skipped.edges += 1;
        warnings.push(`Edge "${id}" was skipped: one of its endpoints is missing.`);
        continue;
      }
      roots.edges.set(
        id,
        toMap({
          ...edge,
          id,
          source: { ...edge.source, nodeId: from },
          target: { ...edge.target, nodeId: to },
        }),
      );
      report.created.edges += 1;
    }

    for (const [key, value] of Object.entries(data.richtext)) {
      const fragmentKey = idFor(key);
      if (roots.richtext.has(fragmentKey)) continue;
      const fragment = new Y.XmlFragment();
      roots.richtext.set(fragmentKey, fragment);
      applyJsonToFragment(fragment, value);
      report.created.fragments += 1;
    }

    for (const file of data.files) {
      const id = idFor(file.id);
      if (roots.assets.has(id)) continue;
      roots.assets.set(
        id,
        toMap({
          id,
          name: file.name,
          mime: file.mime,
          size: file.size,
          sha256: file.sha256,
          state: file.path === null ? 'missing' : 'local',
          createdAt: options.now,
        }),
      );
    }

    for (const id of data.order) {
      const mapped = idFor(id);
      if (roots.nodes.has(mapped)) roots.order.push([mapped]);
    }
  });

  repairOrder(target);
  const pruned = pruneDanglingEdges(target);
  if (pruned.length > 0) {
    warnings.push(`${String(pruned.length)} edge(s) pointed at missing nodes and were dropped.`);
  }
  report.remapped = [...remap.entries()].filter(([from, to]) => from !== to).length;

  return { doc: target, report };
}
