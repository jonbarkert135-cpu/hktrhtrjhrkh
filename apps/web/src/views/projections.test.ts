import { makeEdge, makeNode, type BoardEdge, type BoardNode } from '@nexus/domain';
import { describe, expect, it } from 'vitest';

import {
  graphProjection,
  isViewMode,
  mapPoints,
  projectPoint,
  tableRows,
  timelineBuckets,
} from './projections.ts';

const NOW = '2026-08-17T12:00:00.000Z';

function nodes(): BoardNode[] {
  return [
    makeNode({ id: 'n1', x: 0, y: 0, title: 'Hub' }, NOW),
    makeNode({ id: 'n2', x: 0, y: 0, title: 'Leaf' }, NOW),
    { ...makeNode({ id: 'n3', x: 0, y: 0, title: 'Hidden' }, NOW), hidden: true },
    {
      ...makeNode({ id: 'n4', x: 0, y: 0, title: 'Place', data: { lat: 51.5, lon: -0.12 } }, NOW),
      provenance: {
        ...makeNode({ id: 'x', x: 0, y: 0 }, NOW).provenance,
        observedAt: '2026-01-02T00:00:00.000Z',
      },
    },
  ];
}

function edges(): BoardEdge[] {
  return [
    makeEdge({ id: 'e1', from: 'n1', to: 'n2' }, NOW),
    makeEdge({ id: 'e2', from: 'n1', to: 'n4' }, NOW),
  ];
}

describe('view projections', () => {
  it('sorts table rows by connectivity and skips hidden nodes', () => {
    const rows = tableRows(nodes(), edges());
    expect(rows.map((row) => row.id)).toEqual(['n1', 'n2', 'n4']);
    expect(rows[0]?.degree).toBe(2);
  });

  it('buckets the timeline by day and puts undated last', () => {
    const base = makeNode({ id: 'n5', x: 0, y: 0 }, NOW);
    const undated = {
      ...base,
      createdAt: 'not-a-date',
      provenance: { ...base.provenance, observedAt: null },
    };
    const buckets = timelineBuckets([...nodes(), undated]);
    expect(buckets.map((bucket) => bucket.day)).toEqual(['2026-01-02', '2026-08-17', 'undated']);
  });

  it('maps only nodes with valid coordinates', () => {
    const bad = makeNode({ id: 'n6', x: 0, y: 0, data: { lat: 999, lon: 0 } }, NOW);
    const { points, unplaced } = mapPoints([...nodes(), bad]);
    expect(points.map((point) => point.id)).toEqual(['n4']);
    expect(unplaced).toBe(3);
    expect(projectPoint(points[0]!)).toEqual({ x: (-0.12 + 180) / 360, y: (90 - 51.5) / 180 });
  });

  it('drops links that point at hidden or missing nodes', () => {
    const dangling = makeEdge({ id: 'e3', from: 'n1', to: 'n3' }, NOW);
    const projection = graphProjection(nodes(), [...edges(), dangling]);
    expect(projection.links.map((link) => link.id)).toEqual(['e1', 'e2']);
    expect(projection.nodes).toHaveLength(3);
  });

  it('validates view mode strings', () => {
    expect(isViewMode('table')).toBe(true);
    expect(isViewMode('hologram')).toBe(false);
  });
});
