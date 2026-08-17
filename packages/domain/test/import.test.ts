import { describe, expect, it } from 'vitest';

import { createBoardDoc } from '../src/doc/createBoardDoc.ts';
import { checkGraphInvariants } from '../src/doc/invariants.ts';
import { addNodes, ensureFragment, listEdges, listNodes } from '../src/doc/mutations.ts';
import { boardRoots } from '../src/doc/schema.ts';
import { tx } from '../src/doc/transactions.ts';
import { makeNode } from '../src/entities/node.ts';
import { exportBoard } from '../src/export/exportBoard.ts';
import { ImportError, importBoard, parseBoardExport } from '../src/export/importBoard.ts';
import { applyJsonToFragment, fragmentToJson } from '../src/export/richtext.ts';
import { IMPORT_NODE_LIMIT } from '../src/export/schema.v1.ts';
import { T0, fixtureBoard, seqIds } from './doc-fixtures.ts';

const EXPORT = { appVersion: '1.0.0-test', now: T0 };

describe('board import', () => {
  it('rejects anything that is not a board export', () => {
    expect(() => parseBoardExport(null)).toThrow(ImportError);
    expect(() => parseBoardExport('not json')).toThrow(/not a NEXUS board export/);
  });

  it('reports validation issues instead of importing a broken file', () => {
    const { doc } = fixtureBoard(1, 0);
    const archive = exportBoard(doc, EXPORT) as unknown as Record<string, unknown>;
    const broken = { ...archive, nodes: [{ id: 'n1', type: 'note' }] };
    try {
      parseBoardExport(broken);
      expect.unreachable('a malformed archive must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError);
      expect((error as ImportError).issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects an oversized archive before touching a document', () => {
    const { doc } = fixtureBoard(1, 0);
    const archive = exportBoard(doc, EXPORT) as unknown as Record<string, unknown>;
    const huge = { ...archive, nodes: new Array(IMPORT_NODE_LIMIT + 1).fill(archive.nodes) };
    expect(() => parseBoardExport(huge)).toThrow(/limit for one board/);
  });

  it('copies a board with remapped ids', () => {
    const { doc, nodeIds } = fixtureBoard(3, 2);
    const archive = exportBoard(doc, EXPORT);
    const { doc: copy, report } = importBoard(archive, {
      mode: 'copy',
      newId: seqIds('c_'),
      now: T0,
    });
    expect(report.created.nodes).toBe(3);
    expect(report.remapped).toBeGreaterThanOrEqual(3);
    expect(listNodes(copy).map((node) => node.id)).not.toEqual(nodeIds);
    expect(listEdges(copy)).toHaveLength(2);
    expect(checkGraphInvariants(copy)).toEqual([]);
  });

  it('imports rich text and rewires the fragment key', () => {
    const doc = createBoardDoc({ boardId: 'b_rt', now: T0 });
    addNodes(doc, [makeNode({ id: 'n1', x: 0, y: 0, data: { fragmentKey: 'fk_1' } }, T0)], {
      origin: 'local:create',
      now: T0,
    });
    const fragment = ensureFragment(doc, 'fk_1', 'local:create');
    tx(doc, 'local:edit', () => {
      applyJsonToFragment(fragment, {
        encoding: 'prosemirror-json',
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { align: 'left' },
              content: [{ type: 'text', text: 'Evidence', marks: [{ type: 'em' }] }],
            },
          ],
        },
      });
    });

    const { doc: copy } = importBoard(exportBoard(doc, EXPORT), {
      mode: 'copy',
      newId: seqIds('c_'),
      now: T0,
    });
    const key = listNodes(copy)[0]?.data.fragmentKey;
    expect(typeof key).toBe('string');
    const copied = boardRoots(copy).richtext.get(String(key));
    expect(copied).toBeDefined();
    expect(fragmentToJson(copied as never)).toEqual(fragmentToJson(fragment));
    expect(checkGraphInvariants(copy)).toEqual([]);
  });

  it('marks nodes whose files are missing and skips edges with missing endpoints', () => {
    const { doc } = fixtureBoard(2, 1);
    const archive = exportBoard(doc, EXPORT);
    const first = archive.nodes[0];
    if (first !== undefined) first.data = { ...first.data, fileId: 'f_missing' };
    archive.edges.push({
      ...(archive.edges[0] as (typeof archive.edges)[number]),
      id: 'e_ghost',
      source: { ...(archive.edges[0]?.source as { nodeId: string }), nodeId: 'n_ghost' },
    } as (typeof archive.edges)[number]);

    const { doc: imported, report } = importBoard(archive, {
      mode: 'restore',
      newId: seqIds('i_'),
      now: T0,
    });
    expect(report.skipped.edges).toBe(1);
    expect(report.warnings.join(' ')).toMatch(/file that is not in this archive/);
    expect(listNodes(imported)[0]?.data.fileState).toBe('missing');
  });

  it('imports asset manifests as board-local records', () => {
    const { doc } = fixtureBoard(1, 0);
    const archive = exportBoard(doc, EXPORT);
    archive.files.push({
      id: 'f_1',
      name: 'evidence.png',
      mime: 'image/png',
      size: 1024,
      sha256: 'abc',
      state: 'local',
      path: null,
      metadata: {},
    });
    const { doc: imported } = importBoard(archive, {
      mode: 'restore',
      newId: seqIds('i_'),
      now: T0,
    });
    expect(boardRoots(imported).assets.get('f_1')?.get('state')).toBe('missing');
  });
});
