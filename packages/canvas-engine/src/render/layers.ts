/**
 * The canvas layers (05_CANVAS_ENGINE.md §6.6, §6.8, §6.9; 20_ROADMAP P2 §7 painting order).
 *
 * Every layer is a pure function of `(ctx, frame)` that draws in **world space**: `paintFrame`
 * applies the camera exactly once, so a constant-screen-px value is written as `px / zoom`.
 * Nothing here allocates on the steady-state path — the scratch objects below are reused, which is
 * safe because the engine is single-threaded and a layer never yields mid-draw.
 */

import {
  GRID_MIN_ZOOM,
  GRID_SPACING,
  INDEX_CELL_SIZE,
  LOD_TITLE_MIN_SCREEN_W,
  MIN_NODE_SIZE,
} from '../constants';
import type {
  CameraState,
  ConnectionPreview,
  DrawContext,
  EdgeId,
  EdgeView,
  EngineTheme,
  NodeId,
  NodeView,
  RGBA,
  Rect,
  Vec2,
} from '../types';
import type { PaintLod } from './lod';
import type { MeasureFn, TextCache } from './text';

/* ------------------------------------------------------------------- types */

/**
 * Visual sizes the resolved theme does not carry, in screen px at zoom 1. Injected like the theme
 * (04_DESIGN_SYSTEM.md is the source; the engine never invents a number).
 */
export interface RenderMetrics {
  nodeRadius: number;
  accentStripe: number;
  statusDot: number;
  titlePadding: number;
  handleSize: number;
  /** Radius of the L0 density blob that stands in for a cell full of sub-pixel nodes. */
  densityBlob: number;
  /** Dash length of alignment guides. */
  guideDash: number;
}

/** A snap/alignment guide in world space (05 §7.8). */
export interface AlignmentGuide {
  /** `x` = a vertical line at `position`; `y` = a horizontal one. */
  axis: 'x' | 'y';
  position: number;
  from: number;
  to: number;
}

/**
 * P5 swaps in real routing behind this interface; P2 only ships `straightEdgePath`.
 * `out` is a caller-owned flat `[x0, y0, x1, y1, …]` buffer; the return value is the point count.
 */
export interface EdgePath {
  route(edge: EdgeView, from: NodeView, to: NodeView, out: number[]): number;
}

export const straightEdgePath: EdgePath = {
  route(_edge: EdgeView, from: NodeView, to: NodeView, out: number[]): number {
    out[0] = from.x + from.w / 2;
    out[1] = from.y + from.h / 2;
    out[2] = to.x + to.w / 2;
    out[3] = to.y + to.h / 2;
    return 2;
  },
};

/** Everything a layer is allowed to read. Assembled once per frame by the engine. */
export interface RenderFrame {
  readonly camera: CameraState;
  /** CSS px size of the drawing surface. */
  readonly viewport: { width: number; height: number };
  readonly theme: EngineTheme;
  readonly metrics: RenderMetrics;
  readonly lod: PaintLod;
  readonly showGrid: boolean;
  /** Culled and ordered bottom→top by the scene layer. */
  readonly nodes: readonly NodeView[];
  readonly edges: readonly EdgeView[];
  readonly node: (id: NodeId) => NodeView | undefined;
  readonly selected: readonly NodeView[];
  readonly guides: readonly AlignmentGuide[];
  readonly marquee: Rect | null;
  readonly text: TextCache;
  readonly edgePath: EdgePath;
  /** Selected edge ids: painted wider, in the selection colour, with visible endpoints (P5 §6). */
  readonly selectedEdges: ReadonlySet<EdgeId>;
  /** The in-flight connection, or null. */
  readonly connection: ConnectionPreview | null;
}

/* ---------------------------------------------------------------- scratch */

const pa: Vec2 = { x: 0, y: 0 };
const pb: Vec2 = { x: 0, y: 0 };
const box: Rect = { x: 0, y: 0, w: 0, h: 0 };
const box2: Rect = { x: 0, y: 0, w: 0, h: 0 };
const path: number[] = [];
const dash: number[] = [0, 0];
const density = new Map<number, number>();

const sizeOf = (v: number): number => (v > 0 ? v : MIN_NODE_SIZE);

/* -------------------------------------------------------------------- grid */

export function drawGrid(ctx: DrawContext, frame: RenderFrame): number {
  const { camera, viewport, theme, showGrid } = frame;
  if (showGrid === false || camera.zoom < GRID_MIN_ZOOM) return 0;

  // Keep the on-screen spacing readable (and the loop bounded) by doubling the world step.
  let step = GRID_SPACING;
  while (step * camera.zoom < GRID_SPACING) step *= 2;

  const w = viewport.width / camera.zoom;
  const h = viewport.height / camera.zoom;
  const x0 = Math.floor(camera.x / step) * step;
  const y0 = Math.floor(camera.y / step) * step;
  const radius = 1 / camera.zoom;
  let painted = 0;
  for (let y = y0; y <= camera.y + h; y += step) {
    for (let x = x0; x <= camera.x + w; x += step) {
      pa.x = x;
      pa.y = y;
      ctx.dot(pa, radius, theme.gridDot);
      painted += 1;
    }
  }
  return painted;
}

/* ------------------------------------------------------------------- edges */

export function drawEdges(ctx: DrawContext, frame: RenderFrame): number {
  let painted = 0;
  for (const edge of frame.edges) {
    if (edge.hidden) continue;
    const from = frame.node(edge.from);
    const to = frame.node(edge.to);
    if (from === undefined || to === undefined) continue;

    const count = frame.edgePath.route(edge, from, to, path);
    if (count < 2) continue;
    // ponytail: opacity 1 (the only P2 case) reuses the theme color object and its cached CSS
    // string; translucent edges arrive with P5 degraded routing and pay one small object then.
    const selected = frame.selectedEdges.has(edge.id);
    const color = selected
      ? frame.theme.selectionStroke
      : edge.style.opacity === 1
        ? edge.style.color
        : fade(edge.style.color, edge.style.opacity);
    // A selected edge is drawn one screen px wider, so the emphasis survives every zoom level.
    const width = (edge.style.width + (selected ? 1 : 0)) / frame.camera.zoom;
    for (let i = 1; i < count; i += 1) {
      pa.x = path[(i - 1) * 2] ?? 0;
      pa.y = path[(i - 1) * 2 + 1] ?? 0;
      pb.x = path[i * 2] ?? 0;
      pb.y = path[i * 2 + 1] ?? 0;
      ctx.line(pa, pb, color, width, scaleDash(edge.style.dash, frame.camera.zoom));
    }
    if (selected) {
      // Endpoints as draggable dots and the waypoints they imply (UX §6: "selected edge shows its
      // endpoints"); the dots are screen-sized, like every other handle.
      const dot = frame.metrics.handleSize / (2 * frame.camera.zoom);
      pa.x = path[0] ?? 0;
      pa.y = path[1] ?? 0;
      ctx.dot(pa, dot, frame.theme.selectionStroke);
      pb.x = path[(count - 1) * 2] ?? 0;
      pb.y = path[(count - 1) * 2 + 1] ?? 0;
      ctx.dot(pb, dot, frame.theme.selectionStroke);
    }
    painted += 1;
  }
  return painted;
}

function fade(color: RGBA, opacity: number): RGBA {
  return { r: color.r, g: color.g, b: color.b, a: color.a * opacity };
}

function scaleDash(pattern: readonly number[] | null, zoom: number): readonly number[] | null {
  if (pattern === null || pattern.length === 0) return null;
  dash.length = 0;
  for (const d of pattern) dash.push(d / zoom);
  return dash;
}

/* ------------------------------------------------------------------- nodes */

export function drawNodes(ctx: DrawContext, frame: RenderFrame): number {
  // L3: the DOM overlay owns the pixels; the canvas only paints selection on top (§6.8).
  if (frame.lod === 'dom') return 0;
  return frame.lod === 'dot' ? drawDots(ctx, frame) : drawGlyphs(ctx, frame);
}

function drawDots(ctx: DrawContext, frame: RenderFrame): number {
  const { camera, theme, metrics } = frame;
  density.clear();
  let painted = 0;
  for (const node of frame.nodes) {
    if (node.hidden) continue;
    const w = sizeOf(node.w);
    const h = sizeOf(node.h);
    if (w * camera.zoom < 2) {
      // Sub-pixel: fold it into a per-cell density blob instead of drawing invisible rects.
      const cell = cellKey(node.x, node.y);
      density.set(cell, (density.get(cell) ?? 0) + 1);
      continue;
    }
    box.x = node.x;
    box.y = node.y;
    box.w = w;
    box.h = h;
    ctx.rect(box, node.glyph.fill, null);
    painted += 1;
  }
  for (const [cell, count] of density) {
    const col = cell % CELL_STRIDE;
    const row = (cell - col) / CELL_STRIDE;
    pa.x = (col - CELL_BIAS + 0.5) * INDEX_CELL_SIZE;
    pa.y = (row - CELL_BIAS + 0.5) * INDEX_CELL_SIZE;
    const scale = Math.max(0.25, Math.min(1, Math.sqrt(count) / 8));
    ctx.dot(pa, (metrics.densityBlob * scale) / camera.zoom, theme.nodeFill);
    painted += 1;
  }
  return painted;
}

const CELL_STRIDE = 1 << 16;
const CELL_BIAS = CELL_STRIDE / 2;

/** Packs a cell coordinate pair into one integer key so the density map allocates nothing. */
function cellKey(x: number, y: number): number {
  const col = clampCell(Math.floor(x / INDEX_CELL_SIZE) + CELL_BIAS);
  const row = clampCell(Math.floor(y / INDEX_CELL_SIZE) + CELL_BIAS);
  return row * CELL_STRIDE + col;
}

function clampCell(v: number): number {
  return v < 0 ? 0 : v > CELL_STRIDE - 1 ? CELL_STRIDE - 1 : v;
}

function drawGlyphs(ctx: DrawContext, frame: RenderFrame): number {
  const { camera, theme, metrics } = frame;
  const zoom = camera.zoom;
  const radius = metrics.nodeRadius / zoom;
  const stroke = 1 / zoom;
  const withText = frame.lod === 'glyphText';
  // One bound measurer per frame (not per node): `ctx.measureText` is memoized by the target.
  const measure: MeasureFn = (value, font) => ctx.measureText(value, font);
  const pad = metrics.titlePadding / zoom;
  let painted = 0;

  for (const node of frame.nodes) {
    if (node.hidden) continue;
    const w = sizeOf(node.w);
    const h = sizeOf(node.h);
    box.x = node.x;
    box.y = node.y;
    box.w = w;
    box.h = h;
    ctx.roundRect(box, radius, node.glyph.fill, theme.nodeStroke, stroke);

    box2.x = node.x;
    box2.y = node.y;
    box2.w = metrics.accentStripe / zoom;
    box2.h = h;
    ctx.rect(box2, node.glyph.accent, null);

    if (node.glyph.status !== 'none') {
      pa.x = node.x + w - metrics.statusDot / zoom;
      pa.y = node.y + metrics.statusDot / zoom;
      ctx.dot(pa, metrics.statusDot / zoom, node.glyph.accent);
    }

    // §6.8/§6.9: one clipped title line, and only when the box is wide enough to read it.
    if (withText && w * zoom >= LOD_TITLE_MIN_SCREEN_W && node.glyph.title !== '') {
      const maxWidth = w - metrics.accentStripe / zoom - pad * 2;
      if (maxWidth > 0) {
        const label = frame.text.fit(measure, node.glyph.title, theme.titleFont, maxWidth);
        if (label !== '') {
          pa.x = node.x + metrics.accentStripe / zoom + pad;
          pa.y = node.y + h / 2;
          // The same font string for every title: the target writes ctx.font once per frame.
          ctx.text(pa, label, theme.nodeTitle, theme.titleFont, maxWidth);
        }
      }
    }
    painted += 1;
  }
  return painted;
}

/* --------------------------------------------------------------- selection */

export function drawSelection(ctx: DrawContext, frame: RenderFrame): number {
  const { camera, theme, metrics, selected } = frame;
  if (selected.length === 0) return 0;
  // Constant screen width at any zoom (UX §6.2).
  const width = theme.selectionWidth / camera.zoom;
  const radius = metrics.nodeRadius / camera.zoom;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of selected) {
    const w = sizeOf(node.w);
    const h = sizeOf(node.h);
    box.x = node.x;
    box.y = node.y;
    box.w = w;
    box.h = h;
    ctx.roundRect(box, radius, null, theme.selectionStroke, width);
    if (node.x < minX) minX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.x + w > maxX) maxX = node.x + w;
    if (node.y + h > maxY) maxY = node.y + h;
  }
  if (selected.length === 1) return 1;

  box.x = minX;
  box.y = minY;
  box.w = maxX - minX;
  box.h = maxY - minY;
  ctx.rect(box, null, theme.selectionStroke, width);

  const size = metrics.handleSize / camera.zoom;
  for (let i = 0; i < 8; i += 1) {
    const col = HANDLE_COLS[i] ?? 0;
    const row = HANDLE_ROWS[i] ?? 0;
    box2.x = minX + box.w * col - size / 2;
    box2.y = minY + box.h * row - size / 2;
    box2.w = size;
    box2.h = size;
    ctx.rect(box2, theme.canvasBackground, theme.selectionStroke, width);
  }
  return selected.length;
}

/** nw, n, ne, e, se, s, sw, w — the `ResizeHandle` order from types.ts. */
const HANDLE_COLS: readonly number[] = [0, 0.5, 1, 1, 1, 0.5, 0, 0];
const HANDLE_ROWS: readonly number[] = [0, 0, 0, 0.5, 1, 1, 1, 0.5];

/* ------------------------------------------------------------------ guides */

export function drawGuides(ctx: DrawContext, frame: RenderFrame): number {
  const { camera, theme, metrics } = frame;
  if (frame.guides.length === 0) return 0;
  const width = 1 / camera.zoom;
  dash.length = 0;
  dash.push(metrics.guideDash / camera.zoom, metrics.guideDash / camera.zoom);
  for (const guide of frame.guides) {
    if (guide.axis === 'x') {
      pa.x = guide.position;
      pa.y = guide.from;
      pb.x = guide.position;
      pb.y = guide.to;
    } else {
      pa.x = guide.from;
      pa.y = guide.position;
      pb.x = guide.to;
      pb.y = guide.position;
    }
    ctx.line(pa, pb, theme.guideStroke, width, dash);
  }
  return frame.guides.length;
}

/* -------------------------------------------------------------- connection */

/**
 * The pending connection (P5 §6): a dashed line from the source port to the free end, the free end
 * marked with a dot, and the drop target outlined when the drop would be accepted.
 */
export function drawConnection(ctx: DrawContext, frame: RenderFrame): number {
  const c = frame.connection;
  if (c === null) return 0;
  const zoom = frame.camera.zoom;
  const width = frame.theme.selectionWidth / zoom;
  dash.length = 0;
  dash.push(frame.metrics.guideDash / zoom, frame.metrics.guideDash / zoom);
  pa.x = c.fromPoint.x;
  pa.y = c.fromPoint.y;
  pb.x = c.to.x;
  pb.y = c.to.y;
  const color = c.valid ? frame.theme.selectionStroke : frame.theme.guideStroke;
  ctx.line(pa, pb, color, width, dash);
  ctx.dot(pb, frame.metrics.handleSize / (2 * zoom), color);

  if (c.targetId !== null && c.valid) {
    const target = frame.node(c.targetId);
    if (target !== undefined) {
      box.x = target.x;
      box.y = target.y;
      box.w = sizeOf(target.w);
      box.h = sizeOf(target.h);
      ctx.roundRect(box, frame.metrics.nodeRadius / zoom, null, color, width);
    }
  }
  return 1;
}

/* ----------------------------------------------------------------- marquee */

export function drawMarquee(ctx: DrawContext, frame: RenderFrame): number {
  const m = frame.marquee;
  if (m === null) return 0;
  box.x = Math.min(m.x, m.x + m.w);
  box.y = Math.min(m.y, m.y + m.h);
  box.w = Math.abs(m.w);
  box.h = Math.abs(m.h);
  ctx.rect(box, frame.theme.marqueeFill, frame.theme.marqueeStroke, 1 / frame.camera.zoom);
  return 1;
}

/* ------------------------------------------------------------ composition */

export interface FramePaintCounts {
  nodes: number;
  edges: number;
}

/** The fixed painting order (20_ROADMAP P2 §7). The camera is applied exactly once, here. */
export function paintFrame(ctx: DrawContext, frame: RenderFrame): FramePaintCounts {
  ctx.clear(frame.theme.canvasBackground);
  ctx.save();
  ctx.setCamera(frame.camera);
  drawGrid(ctx, frame);
  const edges = drawEdges(ctx, frame);
  const nodes = drawNodes(ctx, frame);
  drawSelection(ctx, frame);
  drawConnection(ctx, frame);
  drawGuides(ctx, frame);
  drawMarquee(ctx, frame);
  ctx.restore();
  counts.nodes = nodes;
  counts.edges = edges;
  return counts;
}

const counts: FramePaintCounts = { nodes: 0, edges: 0 };
