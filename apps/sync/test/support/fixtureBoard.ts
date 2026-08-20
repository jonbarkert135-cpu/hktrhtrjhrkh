/**
 * A small local fixture — mirrors `packages/domain/test/doc-fixtures.ts` but built from the
 * package's public API only (`apps/sync` cannot reach into another workspace's `test/` dir).
 */

import {
  addEdges,
  addNodes,
  createBoardDoc,
  makeEdge,
  makeNode,
  type BoardNode,
} from '@nexus/domain';
import type * as Y from 'yjs';

export const T0 = '2026-08-17T12:00:00.000Z';

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
    list.push(
      makeNode({ id, type: 'note', x: i * 40, y: i * 25, w: 280, h: 160, title: `Node ${id}` }, T0),
    );
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
