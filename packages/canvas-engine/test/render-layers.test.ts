import { describe, expect, it } from 'vitest';

import { GRID_MIN_ZOOM, LOD_TITLE_MIN_SCREEN_W, MAX_CANVAS_TEXT } from '../src/constants';
import {
  drawEdges,
  drawGrid,
  drawGuides,
  drawMarquee,
  drawNodes,
  drawSelection,
  paintFrame,
  straightEdgePath,
} from '../src/render/layers';
import type { DrawCall } from '../src/render/recording-target';
import { createRecordingTarget } from '../src/render/recording-target';
import { makeEdge, makeFrame, makeNode, metrics, theme } from './render-fixtures';

const opsOf = (calls: readonly DrawCall[]): string[] => calls.map((c) => c.op);

describe('painting order', () => {
  it('paints grid → edges → nodes → selection → guides → marquee (P2 §7)', () => {
    const rec = createRecordingTarget(800, 600, 1);
    const nodes = [makeNode(0), makeNode(1)];
    const frame = makeFrame({
      nodes,
      edges: [makeEdge(0, nodes[0]?.id ?? '', nodes[1]?.id ?? '')],
      selected: [nodes[0] ?? makeNode(0)],
      guides: [{ axis: 'x', position: 100, from: 0, to: 400 }],
      marquee: { x: 0, y: 0, w: 50, h: 50 },
      camera: { x: 0, y: 0, zoom: 0.5 },
      lod: 'glyphText',
    });
    const counts = paintFrame(rec.beginFrame(), frame);
    rec.endFrame();

    expect(counts).toEqual({ nodes: 2, edges: 1, animatedEdges: 0 });
    const ops = opsOf(rec.calls);
    expect(ops[0]).toBe('clear');
    expect(ops[1]).toBe('save');
    expect(ops[2]).toBe('camera');
    expect(ops.at(-1)).toBe('restore');

    const firstGrid = rec.calls.findIndex((c) => c.op === 'dot');
    const edge = rec.calls.findIndex((c) => c.op === 'line');
    const node = rec.calls.findIndex((c) => c.op === 'roundRect' && c.fill !== null);
    const selection = rec.calls.findIndex((c) => c.op === 'roundRect' && c.fill === null);
    const guide = rec.calls.findIndex((c) => c.op === 'line' && c.dash !== null);
    const marquee = rec.calls.findIndex(
      (c) => c.op === 'rect' && c.fill === 'rgba(80,160,255,0.08)',
    );
    expect(firstGrid).toBeLessThan(edge);
    expect(edge).toBeLessThan(node);
    expect(node).toBeLessThan(selection);
    expect(selection).toBeLessThan(guide);
    expect(guide).toBeLessThan(marquee);
  });

  it('reuses the counts object, so a steady-state frame allocates nothing new', () => {
    const rec = createRecordingTarget();
    const frame = makeFrame({ nodes: [makeNode(0)] });
    const a = paintFrame(rec.beginFrame(), frame);
    const b = paintFrame(rec.beginFrame(), frame);
    expect(a).toBe(b);
  });
});

describe('grid layer', () => {
  it('is skipped below GRID_MIN_ZOOM and when the feature is off', () => {
    const rec = createRecordingTarget();
    expect(drawGrid(rec.beginFrame(), makeFrame({ camera: { x: 0, y: 0, zoom: 0.2 } }))).toBe(0);
    expect(drawGrid(rec.beginFrame(), makeFrame({ showGrid: false }))).toBe(0);
    expect(rec.calls).toHaveLength(0);
  });

  it('doubles the world step so the dot count stays bounded as it zooms out', () => {
    const dense = createRecordingTarget();
    const sparse = createRecordingTarget();
    const at = (zoom: number, rec: ReturnType<typeof createRecordingTarget>): number =>
      drawGrid(rec.beginFrame(), makeFrame({ camera: { x: 0, y: 0, zoom } }));
    const near = at(1, dense);
    const far = at(GRID_MIN_ZOOM, sparse);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeLessThanOrEqual(near);
    // 1 screen px radius at any zoom.
    const first = sparse.calls[0];
    expect(first?.op === 'dot' ? first.r : 0).toBeCloseTo(1 / GRID_MIN_ZOOM, 6);
  });
});

describe('edge layer', () => {
  it('draws straight centre-to-centre lines and skips dangling or hidden edges', () => {
    const rec = createRecordingTarget();
    const a = makeNode(0, { x: 0, y: 0, w: 100, h: 100 });
    const b = makeNode(1, { x: 400, y: 200, w: 100, h: 100 });
    const hidden = makeEdge(1, a.id, b.id);
    const frame = makeFrame({
      nodes: [a, b],
      edges: [makeEdge(0, a.id, b.id), { ...hidden, hidden: true }, makeEdge(2, a.id, 'missing')],
    });
    expect(drawEdges(rec.beginFrame(), frame)).toBe(1);
    const line = rec.calls[0];
    expect(line?.op === 'line' ? [line.x1, line.y1, line.x2, line.y2] : []).toEqual([
      50, 50, 450, 250,
    ]);
  });

  it('keeps edge width and dash constant in screen px', () => {
    const rec = createRecordingTarget();
    const a = makeNode(0);
    const b = makeNode(1);
    const dashed = makeEdge(0, a.id, b.id);
    const frame = makeFrame({
      nodes: [a, b],
      edges: [{ ...dashed, style: { ...dashed.style, width: 2, dash: [6, 3], opacity: 0.5 } }],
      camera: { x: 0, y: 0, zoom: 0.25 },
    });
    drawEdges(rec.beginFrame(), frame);
    const line = rec.calls[0];
    expect(line?.op === 'line' ? line.width : 0).toBe(8); // 2 / 0.25
    expect(line?.op === 'line' ? line.dash : '').toBe('24,12');
    expect(line?.op === 'line' ? line.color : '').toContain('0.5');
  });

  it('routes through the EdgePath seam so P5 can swap the router', () => {
    const out: number[] = [];
    const n = straightEdgePath.route(
      makeEdge(0, 'a', 'b'),
      makeNode(0, { x: 0, y: 0, w: 10, h: 10 }),
      makeNode(1, { x: 90, y: 90, w: 10, h: 10 }),
      out,
    );
    expect(n).toBe(2);
    expect(out).toEqual([5, 5, 95, 95]);
  });
});

describe('node layer', () => {
  it('paints nothing at the DOM level — the overlay owns those pixels (§6.8)', () => {
    const rec = createRecordingTarget();
    expect(drawNodes(rec.beginFrame(), makeFrame({ nodes: [makeNode(0)], lod: 'dom' }))).toBe(0);
    expect(rec.calls).toHaveLength(0);
  });

  it('L0 draws flat rects and folds sub-pixel nodes into one density blob per cell', () => {
    const rec = createRecordingTarget();
    const big = makeNode(0, { x: 0, y: 0, w: 400, h: 400 });
    const tiny = Array.from({ length: 12 }, (_, i) =>
      makeNode(i + 1, { x: 10 + i, y: 10, w: 20, h: 20 }),
    );
    const frame = makeFrame({
      nodes: [big, ...tiny, makeNode(99, { hidden: true })],
      lod: 'dot',
      camera: { x: 0, y: 0, zoom: 0.05 },
    });
    const painted = drawNodes(rec.beginFrame(), frame);
    expect(rec.ops('rect')).toHaveLength(1); // only the 400 px node clears 2 device px
    expect(rec.ops('dot')).toHaveLength(1); // 12 sub-pixel nodes share one cell blob
    expect(painted).toBe(2);
  });

  it('L1 draws a rounded body plus accent stripe and no text', () => {
    const rec = createRecordingTarget();
    const frame = makeFrame({
      nodes: [makeNode(0, { glyph: { ...makeNode(0).glyph, status: 'running' } })],
      lod: 'glyph',
      camera: { x: 0, y: 0, zoom: 0.3 },
    });
    expect(drawNodes(rec.beginFrame(), frame)).toBe(1);
    expect(opsOf(rec.calls)).toEqual(['roundRect', 'rect', 'dot']);
    const body = rec.calls[0];
    expect(body?.op === 'roundRect' ? body.radius : 0).toBeCloseTo(metrics.nodeRadius / 0.3, 6);
  });

  it('L2 adds one title per node, all with the same font string', () => {
    const rec = createRecordingTarget();
    const nodes = [makeNode(0), makeNode(1), makeNode(2)];
    drawNodes(rec.beginFrame(), makeFrame({ nodes, lod: 'glyphText' }));
    const texts = rec.ops('text');
    expect(texts).toHaveLength(3);
    expect(new Set(texts.map((t) => (t.op === 'text' ? t.font : '')))).toEqual(
      new Set([theme.titleFont]),
    );
  });

  it('suppresses the title below LOD_TITLE_MIN_SCREEN_W (§6.8)', () => {
    const narrow = makeNode(0, { w: LOD_TITLE_MIN_SCREEN_W - 1 });
    const wide = makeNode(1, { w: LOD_TITLE_MIN_SCREEN_W + 1 });
    const rec = createRecordingTarget();
    drawNodes(rec.beginFrame(), makeFrame({ nodes: [narrow, wide], lod: 'glyphText' }));
    expect(rec.ops('text')).toHaveLength(1);

    // The same nodes at half zoom: the wide one is now under the screen threshold too.
    const zoomed = createRecordingTarget();
    drawNodes(
      zoomed.beginFrame(),
      makeFrame({ nodes: [narrow, wide], lod: 'glyphText', camera: { x: 0, y: 0, zoom: 0.5 } }),
    );
    expect(zoomed.ops('text')).toHaveLength(0);
  });

  it('clips the title to the node box and hard-truncates absurd input', () => {
    const rec = createRecordingTarget();
    const node = makeNode(0, { w: 120, glyph: { ...makeNode(0).glyph, title: 'x'.repeat(4000) } });
    drawNodes(rec.beginFrame(), makeFrame({ nodes: [node], lod: 'glyphText' }));
    const text = rec.ops('text')[0];
    const value = text?.op === 'text' ? text.value : '';
    expect(value.length).toBeLessThan(MAX_CANVAS_TEXT);
    expect(value.endsWith('\u2026')).toBe(true);
  });

  it('clamps a zero-size node to MIN_NODE_SIZE instead of drawing nothing', () => {
    const rec = createRecordingTarget();
    drawNodes(rec.beginFrame(), makeFrame({ nodes: [makeNode(0, { w: 0, h: -5 })], lod: 'glyph' }));
    const body = rec.calls[0];
    expect(body?.op === 'roundRect' ? [body.w, body.h] : []).toEqual([24, 24]);
  });
});

describe('selection layer', () => {
  it('keeps the outline width constant in screen px at any zoom (UX §6)', () => {
    for (const zoom of [0.1, 1, 4]) {
      const rec = createRecordingTarget();
      const node = makeNode(0);
      drawSelection(
        rec.beginFrame(),
        makeFrame({ nodes: [node], selected: [node], camera: { x: 0, y: 0, zoom } }),
      );
      const ring = rec.calls[0];
      const width = ring?.op === 'roundRect' ? ring.width : 0;
      expect(width * zoom).toBeCloseTo(theme.selectionWidth, 6);
    }
  });

  it('adds a bounding box with 8 handles for a multi-selection', () => {
    const rec = createRecordingTarget();
    const a = makeNode(0, { x: 0, y: 0, w: 100, h: 100 });
    const b = makeNode(1, { x: 200, y: 300, w: 100, h: 100 });
    expect(drawSelection(rec.beginFrame(), makeFrame({ nodes: [a, b], selected: [a, b] }))).toBe(2);
    const rects = rec.ops('rect');
    expect(rects).toHaveLength(9); // bounding box + 8 handles
    const boundingBox = rects[0];
    expect(boundingBox?.op === 'rect' ? [boundingBox.w, boundingBox.h] : []).toEqual([300, 400]);
    const corners = rects.slice(1).map((r) => (r.op === 'rect' ? `${r.x},${r.y}` : ''));
    expect(new Set(corners).size).toBe(8);
  });

  it('draws nothing when nothing is selected', () => {
    const rec = createRecordingTarget();
    expect(drawSelection(rec.beginFrame(), makeFrame())).toBe(0);
    expect(rec.calls).toHaveLength(0);
  });
});

describe('guide and marquee layers', () => {
  it('draws dashed guides on both axes at 1 screen px', () => {
    const rec = createRecordingTarget();
    const frame = makeFrame({
      camera: { x: 0, y: 0, zoom: 2 },
      guides: [
        { axis: 'x', position: 100, from: 0, to: 500 },
        { axis: 'y', position: 40, from: 10, to: 90 },
      ],
    });
    expect(drawGuides(rec.beginFrame(), frame)).toBe(2);
    const [v, h] = rec.ops('line');
    expect(v?.op === 'line' ? [v.x1, v.y1, v.x2, v.y2, v.width] : []).toEqual([
      100, 0, 100, 500, 0.5,
    ]);
    expect(h?.op === 'line' ? [h.x1, h.y1, h.x2, h.y2] : []).toEqual([10, 40, 90, 40]);
    expect(v?.op === 'line' ? v.dash : '').toBe('2,2');
    expect(drawGuides(rec.beginFrame(), makeFrame())).toBe(0);
  });

  it('normalizes a marquee dragged up-left', () => {
    const rec = createRecordingTarget();
    expect(
      drawMarquee(rec.beginFrame(), makeFrame({ marquee: { x: 100, y: 100, w: -40, h: -60 } })),
    ).toBe(1);
    const r = rec.calls[0];
    expect(r?.op === 'rect' ? [r.x, r.y, r.w, r.h] : []).toEqual([60, 40, 40, 60]);
    expect(drawMarquee(rec.beginFrame(), makeFrame())).toBe(0);
  });
});
