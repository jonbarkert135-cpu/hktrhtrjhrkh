/** Shared, dependency-free fixtures for the renderer tests (owned by the render agent). */

import type { RenderFrame, RenderMetrics } from '../src/render/layers';
import { straightEdgePath } from '../src/render/layers';
import { createTextCache } from '../src/render/text';
import type { EdgeView, EngineTheme, NodeView, RGBA } from '../src/types';

const rgba = (r: number, g: number, b: number, a = 1): RGBA => ({ r, g, b, a });

export const theme: EngineTheme = {
  canvasBackground: rgba(14, 17, 22),
  gridDot: rgba(40, 44, 52),
  gridLine: rgba(30, 34, 40),
  nodeFill: rgba(24, 28, 34),
  nodeStroke: rgba(60, 66, 74),
  nodeTitle: rgba(232, 234, 238),
  selectionStroke: rgba(80, 160, 255),
  marqueeStroke: rgba(80, 160, 255),
  marqueeFill: rgba(80, 160, 255, 0.08),
  guideStroke: rgba(255, 120, 180),
  edgeStroke: rgba(120, 130, 145),
  minimapViewport: rgba(255, 255, 255, 0.2),
  minimapNode: rgba(120, 130, 145),
  titleFont: '13px Inter',
  selectionWidth: 1.5,
};

export const metrics: RenderMetrics = {
  nodeRadius: 8,
  accentStripe: 2,
  statusDot: 3,
  titlePadding: 8,
  handleSize: 8,
  densityBlob: 6,
  guideDash: 4,
};

/** Deterministic 32-bit LCG — property-style tests must not depend on Math.random. */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function makeNode(i: number, over: Partial<NodeView> = {}): NodeView {
  const base: NodeView = {
    id: `n_${String(i).padStart(6, '0')}`,
    kind: i % 2 === 0 ? 'note' : 'website',
    x: (i % 10) * 320,
    y: Math.floor(i / 10) * 200,
    w: 260,
    h: 140,
    z: i,
    layerId: 'l_0',
    groupId: null,
    rotation: 0,
    locked: false,
    hidden: false,
    glyph: {
      accent: rgba(80, 160, 255),
      fill: rgba(24, 28, 34),
      icon: 'note',
      title: `Node ${i}`,
      badgeCount: 0,
      thumbnailKey: null,
      status: 'none',
    },
    domKey: `note:${i}`,
    visualVersion: 1,
  };
  return { ...base, ...over };
}

export function makeEdge(i: number, from: string, to: string): EdgeView {
  return {
    id: `e_${String(i).padStart(6, '0')}`,
    from,
    to,
    fromAnchor: { side: 'auto', t: 0.5 },
    toAnchor: { side: 'auto', t: 0.5 },
    routing: 'straight',
    style: {
      color: theme.edgeStroke,
      width: 1,
      dash: null,
      arrowStart: false,
      arrowEnd: true,
      opacity: 1,
    },
    label: null,
    z: i,
    hidden: false,
    visualVersion: 1,
  };
}

export function makeFrame(over: Partial<RenderFrame> = {}): RenderFrame {
  const nodes = over.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const base: RenderFrame = {
    camera: { x: 0, y: 0, zoom: 1 },
    viewport: { width: 1440, height: 900 },
    theme,
    metrics,
    lod: 'glyphText',
    showGrid: true,
    nodes,
    edges: [],
    node: (id) => byId.get(id),
    selected: [],
    guides: [],
    marquee: null,
    text: createTextCache(),
    edgePath: straightEdgePath,
  };
  return { ...base, ...over };
}
