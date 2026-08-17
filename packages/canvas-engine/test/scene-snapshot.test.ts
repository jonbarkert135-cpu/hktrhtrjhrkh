import { describe, expect, it } from 'vitest';

import type { PaintLod } from '../src/render/lod';
import { createLodController, toLodLevel } from '../src/render/lod';
import type { RenderFrame } from '../src/render/layers';
import { paintFrame } from '../src/render/layers';
import { createRecordingTarget } from '../src/render/recording-target';
import type { CameraState, EngineClock, NodeView, Rect } from '../src/types';
import { makeEdge, makeFrame, makeNode, prng } from './render-fixtures';

const idleClock: EngineClock = {
  now: () => 0,
  requestFrame: () => 0,
  cancelFrame: () => undefined,
  setTimer: () => 0,
  clearTimer: () => undefined,
};

const viewportWorld = (camera: CameraState, width: number, height: number): Rect => ({
  x: camera.x,
  y: camera.y,
  w: width / camera.zoom,
  h: height / camera.zoom,
});

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Scene generated from a seeded PRNG: no factories, no randomness, no cross-test state. */
function scene(
  count: number,
  seed: number,
  spread: { w: number; h: number },
): { nodes: NodeView[]; edges: ReturnType<typeof makeEdge>[] } {
  const rand = prng(seed);
  const kinds = ['note', 'website', 'image', 'person'];
  const nodes = Array.from({ length: count }, (_, i) =>
    makeNode(i, {
      kind: kinds[Math.floor(rand() * kinds.length)] ?? 'note',
      x: Math.round(rand() * spread.w),
      y: Math.round(rand() * spread.h),
      w: 180 + Math.round(rand() * 8) * 20,
      h: 100 + Math.round(rand() * 4) * 20,
      glyph: {
        ...makeNode(i).glyph,
        title: `Entity ${i} — ${'detail '.repeat(1 + Math.floor(rand() * 3))}`.trim(),
        status: rand() < 0.15 ? 'running' : 'none',
      },
    }),
  );
  const edges = Array.from({ length: Math.floor(count / 2) }, (_, i) => {
    const from = nodes[Math.floor(rand() * nodes.length)];
    const to = nodes[Math.floor(rand() * nodes.length)];
    return makeEdge(i, from?.id ?? '', to?.id ?? '');
  });
  return { nodes, edges };
}

/** The §5.4 text form: what the engine decided, then the draw-call stream it produced. */
function sceneSnapshot(
  name: string,
  frame: RenderFrame,
  lod: PaintLod,
  promoted: NodeView[],
): string {
  const rec = createRecordingTarget(frame.viewport.width, frame.viewport.height, 1);
  const counts = paintFrame(rec.beginFrame(), frame);
  rec.endFrame();

  const selected = new Set(frame.selected.map((n) => n.id));
  const header = [
    `snapshot ${name}`,
    `viewport ${frame.camera.x},${frame.camera.y} @${frame.camera.zoom.toFixed(2)} ` +
      `${frame.viewport.width}x${frame.viewport.height}`,
    `lod ${lod} (${toLodLevel(lod)})`,
    `painted nodes=${counts.nodes} edges=${counts.edges} promoted=${promoted.length}`,
  ];
  const prefix = toLodLevel(lod) === 'dom' ? 'dom ' : 'lod ';
  for (const n of promoted) {
    header.push(
      `${prefix}${n.id} ${n.kind.padEnd(8)} x=${n.x} y=${n.y} w=${n.w} h=${n.h}` +
        (selected.has(n.id) ? ' sel=1' : ''),
    );
  }
  for (const e of frame.edges) header.push(`edge ${e.id} ${e.from}->${e.to} ${e.routing}`);
  return `${header.join('\n')}\n--- draw calls ---\n${rec.toSnapshot()}\n`;
}

describe('scene snapshots (18_TESTING §5.4)', () => {
  it('canvas-40-nodes-z1.0', async () => {
    const { nodes, edges } = scene(40, 12345, { w: 1600, h: 1000 });
    const camera: CameraState = { x: 0, y: 0, zoom: 1 };
    const lod = createLodController(idleClock).levelFor(camera.zoom);
    expect(lod).toBe('dom');

    const view = viewportWorld(camera, 1440, 900);
    const visible = nodes.filter((n) => intersects(n, view));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const selected = visible.slice(0, 2);
    const frame = makeFrame({
      camera,
      nodes: visible,
      edges,
      node: (id) => byId.get(id),
      selected,
      lod,
      showGrid: false, // the grid is exercised in render-layers.test.ts; it would drown the diff
      marquee: null,
    });

    await expect(sceneSnapshot('canvas-40-nodes-z1.0', frame, lod, visible)).toMatchFileSnapshot(
      './__snapshots__/canvas-40-nodes-z1.0.txt',
    );
  });

  it('canvas-500-nodes-z0.3', async () => {
    const { nodes, edges } = scene(500, 98765, { w: 6000, h: 4000 });
    const camera: CameraState = { x: 0, y: 0, zoom: 0.3 };
    const lod = createLodController(idleClock).levelFor(camera.zoom);
    expect(lod).toBe('glyph');

    const view = viewportWorld(camera, 1440, 900);
    const visible = nodes.filter((n) => intersects(n, view));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const frame = makeFrame({
      camera,
      nodes: visible,
      edges: edges.slice(0, 40),
      node: (id) => byId.get(id),
      lod,
      showGrid: false,
    });

    // Requirement 6 / criterion 2: below 0.55 nothing is promoted to the DOM.
    expect(toLodLevel(lod)).not.toBe('dom');
    await expect(sceneSnapshot('canvas-500-nodes-z0.3', frame, lod, [])).toMatchFileSnapshot(
      './__snapshots__/canvas-500-nodes-z0.3.txt',
    );
  });

  it('is deterministic: the same scene renders the same call stream twice', () => {
    const { nodes, edges } = scene(40, 12345, { w: 1600, h: 1000 });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const build = (): string => {
      const rec = createRecordingTarget(800, 600, 1);
      paintFrame(rec.beginFrame(), makeFrame({ nodes, edges, node: (id) => byId.get(id) }));
      rec.endFrame();
      return rec.toSnapshot();
    };
    expect(build()).toBe(build());
  });
});
