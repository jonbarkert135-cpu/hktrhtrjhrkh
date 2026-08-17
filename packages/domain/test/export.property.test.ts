/**
 * N9 — export/import round-trip is lossless (P3 §5.13, 08_DATA_MODEL.md §8.2).
 *
 * The property generates arbitrary boards (nodes with unknown payload keys, edges, groups, rich
 * text) and asserts that `import(export(doc))` re-exports byte-identically, that export is
 * deterministic, and that a second import is idempotent.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createBoardDoc } from '../src/doc/createBoardDoc.ts';
import { addEdges, addGroup, addNodes, ensureFragment } from '../src/doc/mutations.ts';
import { boardRoots } from '../src/doc/schema.ts';
import { tx } from '../src/doc/transactions.ts';
import { makeEdge } from '../src/entities/edge.ts';
import { makeGroup } from '../src/entities/group.ts';
import { makeNode, type BoardNode } from '../src/entities/node.ts';
import { exportBoard, serializeBoardExport } from '../src/export/exportBoard.ts';
import { importBoard } from '../src/export/importBoard.ts';
import { applyJsonToFragment } from '../src/export/richtext.ts';
import { T0, seqIds } from './doc-fixtures.ts';

const EXPORT_OPTIONS = { appVersion: '1.0.0-test', now: T0 };

interface GeneratedBoard {
  nodes: number;
  edges: number;
  groups: number;
  fragments: number;
  payload: Record<string, unknown>;
}

const boardArb: fc.Arbitrary<GeneratedBoard> = fc.record({
  nodes: fc.integer({ min: 1, max: 24 }),
  edges: fc.integer({ min: 0, max: 12 }),
  groups: fc.integer({ min: 0, max: 3 }),
  fragments: fc.integer({ min: 0, max: 3 }),
  payload: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 8 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    { maxKeys: 5 },
  ),
});

function buildBoard(spec: GeneratedBoard) {
  const doc = createBoardDoc({ boardId: 'b_prop', title: 'Property board', now: T0 });
  const nodes: BoardNode[] = [];
  for (let i = 0; i < spec.nodes; i += 1) {
    nodes.push(
      makeNode(
        {
          id: `n_${String(i).padStart(4, '0')}`,
          type: i % 5 === 0 ? 'plugin:unknown-type' : 'note',
          x: i * 13,
          y: i * 7,
          title: `Node ${String(i)}`,
          data: { ...spec.payload, index: i },
        },
        T0,
      ),
    );
  }
  addNodes(doc, nodes, { origin: 'local:create', now: T0 });

  const edges = [];
  for (let i = 0; i < spec.edges && spec.nodes >= 2; i += 1) {
    edges.push(
      makeEdge(
        {
          id: `e_${String(i).padStart(4, '0')}`,
          from: nodes[i % nodes.length]?.id ?? '',
          to: nodes[(i + 1) % nodes.length]?.id ?? '',
          label: `rel ${String(i)}`,
        },
        T0,
      ),
    );
  }
  if (edges.length > 0) addEdges(doc, edges, { origin: 'local:create', now: T0 });

  for (let i = 0; i < spec.groups; i += 1) {
    addGroup(
      doc,
      makeGroup(
        {
          id: `g_${String(i)}`,
          x: 0,
          y: 0,
          w: 500,
          h: 400,
          label: `Group ${String(i)}`,
          childIds: [nodes[i]?.id ?? ''].filter(Boolean),
        },
        T0,
      ),
      { origin: 'local:create', now: T0 },
    );
  }

  for (let i = 0; i < spec.fragments; i += 1) {
    const key = `fk_${String(i)}`;
    const fragment = ensureFragment(doc, key, 'local:create');
    tx(doc, 'local:edit', () => {
      applyJsonToFragment(fragment, {
        encoding: 'prosemirror-json',
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: `Paragraph ${String(i)} ` },
                { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
              ],
            },
          ],
        },
      });
    });
    const owner = boardRoots(doc).nodes.get(nodes[i]?.id ?? '');
    if (owner !== undefined) {
      tx(doc, 'local:edit', () => {
        owner.set('data', { ...(nodes[i]?.data ?? {}), fragmentKey: key });
      });
    }
  }

  return doc;
}

describe('board export (N9 round-trip)', () => {
  it('re-exports identically after an import that keeps ids', () => {
    fc.assert(
      fc.property(boardArb, (spec) => {
        const doc = buildBoard(spec);
        const first = exportBoard(doc, EXPORT_OPTIONS);
        const { doc: restored, report } = importBoard(first, {
          mode: 'restore',
          newId: seqIds('r_'),
          now: T0,
        });
        const second = exportBoard(restored, EXPORT_OPTIONS);
        expect(serializeBoardExport(second)).toBe(serializeBoardExport(first));
        expect(report.created.nodes).toBe(spec.nodes);
        expect(report.skipped.nodes).toBe(0);
      }),
      { numRuns: 25 },
    );
  });

  it('is deterministic: the same document exports byte-identically twice', () => {
    fc.assert(
      fc.property(boardArb, (spec) => {
        const doc = buildBoard(spec);
        expect(serializeBoardExport(exportBoard(doc, EXPORT_OPTIONS))).toBe(
          serializeBoardExport(exportBoard(doc, EXPORT_OPTIONS)),
        );
      }),
      { numRuns: 15 },
    );
  });

  it('preserves unknown payload keys through the round-trip', () => {
    const doc = buildBoard({
      nodes: 2,
      edges: 1,
      groups: 0,
      fragments: 0,
      payload: { pluginOnlyField: 'keep me', nested: null },
    });
    const exported = exportBoard(doc, EXPORT_OPTIONS);
    const { doc: restored } = importBoard(exported, {
      mode: 'restore',
      newId: seqIds('r_'),
      now: T0,
    });
    const node = exportBoard(restored, EXPORT_OPTIONS).nodes[0];
    expect(node?.data.pluginOnlyField).toBe('keep me');
  });

  it('merges an archive into an existing board with fully remapped ids', () => {
    const doc = buildBoard({ nodes: 4, edges: 2, groups: 1, fragments: 1, payload: {} });
    const exported = exportBoard(doc, EXPORT_OPTIONS);
    const { doc: restored } = importBoard(exported, {
      mode: 'restore',
      newId: seqIds('r_'),
      now: T0,
    });
    const { report } = importBoard(exported, {
      mode: 'merge-into',
      into: restored,
      newId: seqIds('m_'),
      now: T0,
    });
    const merged = exportBoard(restored, EXPORT_OPTIONS);
    expect(report.created.nodes).toBe(4);
    expect(report.remapped).toBeGreaterThan(0);
    expect(merged.nodes).toHaveLength(8);
    expect(merged.edges).toHaveLength(4);
    expect(new Set(merged.order).size).toBe(8);
  });
});
