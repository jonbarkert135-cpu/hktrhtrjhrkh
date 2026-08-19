/**
 * Edge layer additions of P5 part 4: the flow animation (07 §10.4), waypoint handles (§8.3) and the
 * per-frame sibling/bundling preamble (§7.6).
 */

import { describe, expect, it } from 'vitest';

import { MAX_ANIMATED_EDGES, drawEdges, straightEdgePath } from '../../src/render/layers';
import { createRecordingTarget } from '../../src/render/recording-target';
import { makeEdge, makeFrame, makeNode } from '../render-fixtures';
import type { EdgeView } from '../../src/types';

const nodes = [makeNode(0), makeNode(1)];
const from = nodes[0]?.id ?? '';
const to = nodes[1]?.id ?? '';

const animated = (i = 0): EdgeView => {
  const edge = makeEdge(i, from, to);
  return { ...edge, style: { ...edge.style, animated: true } };
};

const dashedCalls = (calls: readonly { op: string; dash?: string | null }[]): number =>
  calls.filter((c) => c.op === 'line' && c.dash === '6,10').length;

describe('flow animation', () => {
  it('draws a moving dashed stroke over an animated edge', () => {
    const rec = createRecordingTarget();
    const frame = makeFrame({
      nodes,
      edges: [animated()],
      edgePath: straightEdgePath,
      timeMs: 500,
    });
    drawEdges(rec.beginFrame(), frame);
    const flow = rec.calls.filter((c) => c.op === 'line' && c.dash === '6,10');
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({ dashOffset: -(500 * 0.018) % 16 });
  });

  it('freezes under prefers-reduced-motion (N6)', () => {
    const rec = createRecordingTarget();
    const frame = makeFrame({
      nodes,
      edges: [animated()],
      edgePath: straightEdgePath,
      timeMs: 500,
      reducedMotion: true,
    });
    drawEdges(rec.beginFrame(), frame);
    expect(dashedCalls(rec.calls)).toBe(0);
  });

  it('caps the animated set per frame', () => {
    const rec = createRecordingTarget();
    const edges = Array.from({ length: MAX_ANIMATED_EDGES + 10 }, (_, i) => animated(i));
    const frame = makeFrame({ nodes, edges, edgePath: straightEdgePath, timeMs: 0 });
    drawEdges(rec.beginFrame(), frame);
    expect(dashedCalls(rec.calls)).toBe(MAX_ANIMATED_EDGES);
  });
});

describe('waypoint handles', () => {
  it('draws a dot per waypoint only while the edge is selected', () => {
    const edge: EdgeView = { ...makeEdge(0, from, to), waypoints: [{ x: 10, y: 20 }] };
    const dots = (selected: boolean): number => {
      const rec = createRecordingTarget();
      drawEdges(
        rec.beginFrame(),
        makeFrame({
          nodes,
          edges: [edge],
          edgePath: straightEdgePath,
          ...(selected ? { selectedEdges: new Set([edge.id]) } : {}),
        }),
      );
      return rec.calls.filter((c) => c.op === 'dot').length;
    };
    expect(dots(false)).toBe(0);
    // Two endpoint dots plus the waypoint.
    expect(dots(true)).toBe(3);
  });
});

describe('per-frame preamble', () => {
  it('hands the culled edge set to the router before routing (bundling input)', () => {
    const rec = createRecordingTarget();
    const seen: number[] = [];
    const edges = [makeEdge(0, from, to), makeEdge(1, from, to)];
    drawEdges(
      rec.beginFrame(),
      makeFrame({
        nodes,
        edges,
        edgePath: {
          prepare: (list) => seen.push(list.length),
          route: straightEdgePath.route,
        },
      }),
    );
    expect(seen).toEqual([2]);
  });
});
