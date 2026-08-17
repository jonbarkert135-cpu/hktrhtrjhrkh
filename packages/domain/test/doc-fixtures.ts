/**
 * Deterministic board-document fixtures shared by the P3 test suites. Ids are sequential so
 * failures are readable and exports are byte-stable.
 */

import type * as Y from 'yjs';

import { createBoardDoc } from '../src/doc/createBoardDoc.ts';
import { addEdges, addNodes } from '../src/doc/mutations.ts';
import { makeEdge } from '../src/entities/edge.ts';
import { makeNode, type BoardNode } from '../src/entities/node.ts';

export const T0 = '2026-08-17T12:00:00.000Z';

export function seqIds(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
  };
}

export function fixtureNode(id: string, index = 0, extra: Partial<BoardNode> = {}): BoardNode {
  return {
    ...makeNode(
      {
        id,
        type: index % 2 === 0 ? 'note' : 'website',
        x: index * 40,
        y: index * 25,
        w: 280,
        h: 160,
        title: `Node ${id}`,
        tags: index % 3 === 0 ? ['case/1'] : [],
        data: { text: `body ${id}`, custom: { keptForwardCompatible: true } },
      },
      T0,
    ),
    ...extra,
  };
}

export interface FixtureBoard {
  doc: Y.Doc;
  nodeIds: string[];
  edgeIds: string[];
}

export function fixtureBoard(nodes = 3, edges = 2): FixtureBoard {
  const doc = createBoardDoc({ boardId: 'b_fixture', title: 'Fixture', now: T0 });
  const nodeIds: string[] = [];
  const list: BoardNode[] = [];
  for (let i = 0; i < nodes; i += 1) {
    const id = `n_${String(i + 1).padStart(4, '0')}`;
    nodeIds.push(id);
    list.push(fixtureNode(id, i));
  }
  addNodes(doc, list, { origin: 'local:create', now: T0 });

  const edgeIds: string[] = [];
  const edgeList = [];
  for (let i = 0; i < edges && nodes >= 2; i += 1) {
    const id = `e_${String(i + 1).padStart(4, '0')}`;
    edgeIds.push(id);
    edgeList.push(
      makeEdge(
        {
          id,
          from: nodeIds[i % nodes] ?? '',
          to: nodeIds[(i + 1) % nodes] ?? '',
          label: `edge ${String(i)}`,
        },
        T0,
      ),
    );
  }
  if (edgeList.length > 0) addEdges(doc, edgeList, { origin: 'local:create', now: T0 });

  return { doc, nodeIds, edgeIds };
}
