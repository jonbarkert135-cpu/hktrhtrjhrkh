/**
 * Forward-only document migrations (08_DATA_MODEL.md §8.6). Each step is pure and idempotent; the
 * runner applies steps in order until `to === CURRENT_SCHEMA_VERSION`.
 *
 * `migrateExport` runs on archive JSON *before* it becomes a document, so old archives keep
 * importing forever; `migrateDoc` runs on an already-loaded document inside one `system:migration`
 * transaction, which keeps it off the undo stack.
 */

import type * as Y from 'yjs';

import { CURRENT_SCHEMA_VERSION, boardRoots } from './schema.ts';
import { tx } from './transactions.ts';

export interface Migration {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  migrateExport(json: Record<string, unknown>): Record<string, unknown>;
  migrateDoc(doc: Y.Doc, now: string): void;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/**
 * v0 → v1: the pre-release format had no `provenance`, no `status` and no `order` array. Nodes
 * without provenance become `kind: 'import'` records so invariant §7.8 holds after the upgrade.
 */
const v0ToV1: Migration = {
  from: 0,
  to: 1,
  description: 'add provenance, status and the explicit z-order array',
  migrateExport(json) {
    const nodes = Array.isArray(json.nodes) ? json.nodes : [];
    const migratedNodes = nodes.map((raw) => {
      const node = asRecord(raw);
      const createdAt = typeof node.createdAt === 'string' ? node.createdAt : undefined;
      return {
        ...node,
        status: node.status ?? 'active',
        provenance: node.provenance ?? {
          kind: 'import',
          source: null,
          observedAt: createdAt ?? null,
          importedAt: createdAt ?? null,
        },
      };
    });
    const order = Array.isArray(json.order)
      ? json.order
      : migratedNodes.map((node) => asRecord(node).id).filter((id) => typeof id === 'string');
    const board = { ...asRecord(json.board), schemaVersion: 1 };
    return {
      ...json,
      format: 'nexus.board.v1',
      board,
      nodes: migratedNodes,
      edges: Array.isArray(json.edges) ? json.edges : [],
      groups: Array.isArray(json.groups) ? json.groups : [],
      richtext: asRecord(json.richtext),
      order,
      files: Array.isArray(json.files) ? json.files : [],
      comments: Array.isArray(json.comments) ? json.comments : [],
      extensions: asRecord(json.extensions),
      generator: { app: 'nexus', version: '0', schemaVersion: 1, ...asRecord(json.generator) },
    };
  },
  migrateDoc(doc, now) {
    const roots = boardRoots(doc);
    roots.nodes.forEach((node, id) => {
      if (node.get('provenance') === undefined) {
        const createdAt = node.get('createdAt');
        node.set('provenance', {
          kind: 'import',
          source: null,
          observedAt: typeof createdAt === 'string' ? createdAt : now,
          importedAt: now,
        });
      }
      if (node.get('status') === undefined) node.set('status', 'active');
      if (!roots.order.toArray().includes(id)) roots.order.push([id]);
    });
  },
};

export const MIGRATIONS: readonly Migration[] = [v0ToV1];

export function migrationsFrom(version: number): Migration[] {
  const chain: Migration[] = [];
  let current = version;
  while (current < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS.find((migration) => migration.from === current);
    if (step === undefined) {
      throw new Error(
        `No migration from document schema version ${String(current)} to ${String(CURRENT_SCHEMA_VERSION)}.`,
      );
    }
    chain.push(step);
    current = step.to;
  }
  return chain;
}

/** Reads the archive's schema version, defaulting to 0 for pre-release files. */
export function exportSchemaVersion(json: Record<string, unknown>): number {
  const generator = asRecord(json.generator);
  if (typeof generator.schemaVersion === 'number') return generator.schemaVersion;
  const board = asRecord(json.board);
  if (typeof board.schemaVersion === 'number') return board.schemaVersion;
  return 0;
}

export interface MigrationResult {
  json: Record<string, unknown>;
  applied: string[];
}

export function migrateExportJson(json: Record<string, unknown>): MigrationResult {
  const version = exportSchemaVersion(json);
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This file was written by a newer version of NEXUS (document schema ${String(version)}). Update the app to open it.`,
    );
  }
  let current = json;
  const applied: string[] = [];
  for (const migration of migrationsFrom(version)) {
    current = migration.migrateExport(current);
    applied.push(`${String(migration.from)}→${String(migration.to)}: ${migration.description}`);
  }
  return { json: current, applied };
}

/** Upgrades a loaded document in place. Returns the list of applied step descriptions. */
export function migrateDocument(doc: Y.Doc, now: string): string[] {
  const roots = boardRoots(doc);
  const raw = roots.meta.get('schemaVersion');
  const version = typeof raw === 'number' ? raw : 0;
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This board was written by a newer version of NEXUS (document schema ${String(version)}); it can only be opened read-only.`,
    );
  }
  const chain = migrationsFrom(version);
  if (chain.length === 0) return [];
  const applied: string[] = [];
  tx(doc, 'system:migration', () => {
    for (const migration of chain) {
      migration.migrateDoc(doc, now);
      applied.push(`${String(migration.from)}→${String(migration.to)}: ${migration.description}`);
    }
    roots.meta.set('schemaVersion', CURRENT_SCHEMA_VERSION);
    roots.meta.set('lastMigratedAt', now);
  });
  return applied;
}
