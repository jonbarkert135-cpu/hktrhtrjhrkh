import { describe, expect, it } from 'vitest';

import { createRoutedEdgePath } from '../src/render/routed-edge-path';
import { drawEdges } from '../src/render/layers';
import { makeEdge, makeFrame, makeNode } from './render-fixtures';
import { createRecordingTarget } from '../src/render/recording-target';
import type { EdgeView, NodeView } from '../src/types';

const from: NodeView = makeNode(0, { id: 'a', x: 0, y: 0, w: 200, h: 100 });
const to: NodeView = makeNode(1, { id: 'b', x: 800, y: 400, w: 200, h: 100 });
const edge: EdgeView = { ...makeEdge(0, 'a', 'b'), routing: 'curved' };

describe('createRoutedEdgePath', () => {
  it('writes a routed polyline into the caller buffer', () => {
    const path = createRoutedEdgePath({ cardRadius: 8 });
    const out: number[] = [];
    const count = path.route(edge, from, to, out);
    expect(count).toBeGreaterThan(2);
    expect(out).toHaveLength(count * 2);
    // A curved route leaves the card and reaches the other one.
    expect(out[0]).toBeGreaterThanOrEqual(0);
    expect(out[out.length - 2]).toBeLessThanOrEqual(1000);
  });

  it('reuses cached geometry until the edge or a node changes', () => {
    const path = createRoutedEdgePath();
    const out: number[] = [];
    path.route(edge, from, to, out);
    path.route(edge, from, to, out);
    expect(path.cache.stats.hits).toBe(1);

    path.route({ ...edge, visualVersion: 2 }, from, to, out);
    expect(path.cache.stats.misses).toBe(2);
  });

  it('invalidates the edges incident to a moved node', () => {
    const path = createRoutedEdgePath();
    const out: number[] = [];
    path.route(edge, from, to, out);
    expect(path.invalidateNode('a')).toBe(1);
    path.route(edge, from, to, out);
    expect(path.cache.stats.hits).toBe(0);
  });

  it('bumps the obstacle epoch so orthogonal geometry cannot go stale', () => {
    const path = createRoutedEdgePath();
    const before = path.cache.obstacleEpoch;
    path.invalidateObstacles();
    expect(path.cache.obstacleEpoch).toBe(before + 1);
  });

  it('exposes the last geometry for hit-testing and labels', () => {
    const path = createRoutedEdgePath();
    expect(path.geometry(edge.id)).toBeUndefined();
    path.route(edge, from, to, []);
    expect(path.geometry(edge.id)?.mode).toBe('curved');
  });

  it('honours explicit anchors, the zoom and the draft quality', () => {
    const path = createRoutedEdgePath({
      zoom: () => 0.02,
      quality: () => 'draft',
    });
    const anchored: EdgeView = {
      ...edge,
      fromAnchor: { side: 'right', t: 0.5 },
      toAnchor: { side: 'left', t: 0.5 },
    };
    path.route(anchored, from, to, []);
    // At 0.02 zoom the edge is under 40 screen px, so it degrades to a straight line.
    expect(path.geometry(anchored.id)?.mode).toBe('straight');
  });

  it('drives the edge layer end to end', () => {
    const rec = createRecordingTarget(800, 600, 1);
    const frame = makeFrame({
      nodes: [from, to],
      edges: [edge],
      edgePath: createRoutedEdgePath({ cardRadius: 8 }),
    });
    const ctx = rec.beginFrame();
    expect(drawEdges(ctx, frame)).toBe(1);
    rec.endFrame();
    expect(rec.ops('line').length).toBeGreaterThan(1);
  });
});
