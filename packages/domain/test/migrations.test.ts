import { describe, expect, it } from 'vitest';

import { createBoardDoc } from '../src/doc/createBoardDoc.ts';
import {
  exportSchemaVersion,
  migrateDocument,
  migrateExportJson,
  migrationsFrom,
  normalizeLegacyBrand,
} from '../src/doc/migrations.ts';
import { addNodes, listNodes } from '../src/doc/mutations.ts';
import { boardRoots } from '../src/doc/schema.ts';
import { makeNode } from '../src/entities/node.ts';
import { importBoard } from '../src/export/importBoard.ts';
import { T0, seqIds } from './doc-fixtures.ts';

/** A v0 archive as written by the pre-release build: no provenance, no status, no order. */
const v0Archive = {
  format: 'raven.board.v0',
  exportedAt: T0,
  board: {
    boardId: 'b_old',
    projectId: null,
    title: 'Old board',
    createdAt: T0,
    updatedAt: T0,
  },
  nodes: [
    {
      id: 'n_old_1',
      type: 'note',
      x: 10,
      y: 20,
      w: 280,
      h: 160,
      title: 'Legacy note',
      createdAt: T0,
      updatedAt: T0,
      data: { text: 'hello' },
    },
  ],
  edges: [],
};

describe('document migrations', () => {
  it('reports the chain needed to reach the current version', () => {
    expect(migrationsFrom(1)).toEqual([]);
    expect(migrationsFrom(0).map((step) => step.to)).toEqual([1]);
  });

  it('reads the schema version from the generator or the board', () => {
    expect(exportSchemaVersion({ generator: { schemaVersion: 3 } })).toBe(3);
    expect(exportSchemaVersion({ board: { schemaVersion: 2 } })).toBe(2);
    expect(exportSchemaVersion({})).toBe(0);
  });

  it('migrates a v0 archive so it imports cleanly', () => {
    const { json, applied } = migrateExportJson(v0Archive);
    expect(applied).toHaveLength(1);
    expect(json.format).toBe('raven.board.v1');

    const { doc, report } = importBoard(v0Archive, {
      mode: 'restore',
      newId: seqIds('m_'),
      now: T0,
    });
    expect(report.migrations).toHaveLength(1);
    const node = listNodes(doc)[0];
    expect(node?.provenance.kind).toBe('import');
    expect(node?.status).toBe('active');
    expect(boardRoots(doc).order.toArray()).toEqual(['n_old_1']);
  });

  it('opens archives written before the NEXUS to Raven rename', () => {
    const current = migrateExportJson(v0Archive).json;
    const preRename = {
      ...current,
      format: 'nexus.board.v1',
      generator: { ...(current.generator as Record<string, unknown>), app: 'nexus' },
    };

    const { json, applied } = migrateExportJson(preRename);
    expect(json.format).toBe('raven.board.v1');
    expect((json.generator as Record<string, unknown>).app).toBe('raven');
    // Only the brand strings change: a pre-rename v1 file needs no schema migration.
    expect(applied).toEqual([]);

    const { doc } = importBoard(preRename, { mode: 'restore', newId: seqIds('r_'), now: T0 });
    expect(listNodes(doc)[0]?.id).toBe('n_old_1');
  });

  it('leaves current archives untouched when normalizing the brand', () => {
    const current = migrateExportJson(v0Archive).json;
    expect(normalizeLegacyBrand(current)).toBe(current);
    expect(normalizeLegacyBrand({ format: 'nexus.board.v0' }).format).toBe('raven.board.v0');
  });

  it('is idempotent: migrating an already-current archive is a no-op', () => {
    const once = migrateExportJson(v0Archive).json;
    const twice = migrateExportJson(once);
    expect(twice.applied).toEqual([]);
    expect(JSON.stringify(twice.json)).toBe(JSON.stringify(once));
  });

  it('refuses documents written by a newer app', () => {
    expect(() => migrateExportJson({ generator: { schemaVersion: 99 } })).toThrow(/newer version/i);
    const doc = createBoardDoc({ boardId: 'b_future', now: T0 });
    doc.transact(() => boardRoots(doc).meta.set('schemaVersion', 99));
    expect(() => migrateDocument(doc, T0)).toThrow(/read-only/i);
  });

  it('upgrades a loaded document in one system transaction', () => {
    const doc = createBoardDoc({ boardId: 'b_up', now: T0 });
    addNodes(doc, [makeNode({ id: 'n1', x: 0, y: 0 }, T0)], { origin: 'local:create', now: T0 });
    doc.transact(() => {
      const roots = boardRoots(doc);
      roots.meta.set('schemaVersion', 0);
      roots.nodes.get('n1')?.delete('provenance');
      roots.nodes.get('n1')?.delete('status');
      roots.order.delete(0, roots.order.length);
    });

    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction) => origins.push(transaction.origin));
    const applied = migrateDocument(doc, '2026-09-01T00:00:00.000Z');

    expect(applied).toHaveLength(1);
    expect(origins).toEqual(['system:migration']);
    const roots = boardRoots(doc);
    expect(roots.meta.get('schemaVersion')).toBe(1);
    expect(roots.meta.get('lastMigratedAt')).toBe('2026-09-01T00:00:00.000Z');
    expect(roots.order.toArray()).toEqual(['n1']);
    expect(listNodes(doc)[0]?.provenance.kind).toBe('import');
    expect(migrateDocument(doc, T0)).toEqual([]);
  });
});
