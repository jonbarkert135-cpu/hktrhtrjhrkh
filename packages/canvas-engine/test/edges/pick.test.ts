/** Edge picking over the last painted geometry (20_ROADMAP P5 §5.10). */

import { describe, expect, it } from 'vitest';

import { createEdgePicker } from '../../src/edges/pick';
import { createRoutedEdgePath } from '../../src/render/routed-edge-path';
import { makeEdge, makeNode } from '../render-fixtures';
import type { EdgeView, NodeView } from '../../src/types';

const a: NodeView = makeNode(0, { id: 'a', x: 0, y: 0, w: 100, h: 60 });
const b: NodeView = makeNode(1, { id: 'b', x: 400, y: 0, w: 100, h: 60 });
const c: NodeView = makeNode(2, { id: 'c', x: 0, y: 400, w: 100, h: 60 });

const straight = (id: string, from: string, to: string): EdgeView => ({
  ...makeEdge(0, from, to),
  id,
  routing: 'straight',
});

function routed(edges: readonly EdgeView[], nodes: readonly NodeView[]) {
  const path = createRoutedEdgePath();
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const out: number[] = [];
  for (const edge of edges) {
    path.route(edge, byId.get(edge.from) as NodeView, byId.get(edge.to) as NodeView, out);
  }
  return path;
}

describe('createEdgePicker', () => {
  const ab = straight('ab', 'a', 'b');
  const ac = straight('ac', 'a', 'c');

  it('picks the edge under the point and nothing far from it', () => {
    const path = routed([ab, ac], [a, b, c]);
    const pick = createEdgePicker({ source: path });
    // Midway between the two card centres, on the a→b line.
    expect(pick({ x: 250, y: 30 }, 10, [ab, ac])).toBe('ab');
    expect(pick({ x: 250, y: 200 }, 10, [ab, ac])).toBeNull();
  });

  it('returns null for edges that were never painted', () => {
    const pick = createEdgePicker({ source: createRoutedEdgePath() });
    expect(pick({ x: 250, y: 30 }, 10, [ab])).toBeNull();
  });

  it('skips hidden edges', () => {
    const path = routed([ab], [a, b]);
    const pick = createEdgePicker({ source: path });
    expect(pick({ x: 250, y: 30 }, 10, [{ ...ab, hidden: true }])).toBeNull();
  });

  it('lets the selected edge win a tie', () => {
    const overlapping = straight('ab2', 'a', 'b');
    const path = routed([ab, overlapping], [a, b]);
    const pick = createEdgePicker({ source: path, isSelected: (id) => id === 'ab2' });
    expect(pick({ x: 250, y: 30 }, 10, [ab, overlapping])).toBe('ab2');
  });
});
