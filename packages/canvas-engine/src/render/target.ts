/**
 * The browser `RenderTarget`: a thin, allocation-shy wrapper over a 2D context that the caller
 * supplies (05_CANVAS_ENGINE.md §4 for DPR, §6.9 for the text cache).
 *
 * The canvas is passed in — nothing is read from a module-scope global, so importing this file in
 * Node is inert (00_MASTER.md §4).
 */

import { MAX_DPR, TEXT_CACHE_LIMIT } from '../constants';
import type { CameraState, DrawContext, RGBA, Rect, RenderTarget, Vec2 } from '../types';
import { createLru, truncateHard } from './text';

/* -------------------------------------------------------------- host types */

/**
 * Structural subsets of the DOM types, satisfied by `HTMLCanvasElement` /
 * `CanvasRenderingContext2D` and by a plain object in tests — which is what keeps this file
 * testable in a node-only vitest environment (18_TESTING.md §5.1).
 */
export interface CanvasSizeStyle {
  width: string;
  height: string;
}

export interface Context2DLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  roundRect(x: number, y: number, w: number, h: number, radii: number): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
}

export interface CanvasLike {
  width: number;
  height: number;
  style: CanvasSizeStyle;
  getContext(contextId: '2d'): Context2DLike | null;
}

/* ------------------------------------------------------------------ colors */

const colorCache = new WeakMap<RGBA, string>();

/** Memoized per theme-color object; `invalidate('theme')` hands the engine a fresh theme object. */
export function cssColor(c: RGBA): string {
  const hit = colorCache.get(c);
  if (hit !== undefined) return hit;
  const s = `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a})`;
  colorCache.set(c, s);
  return s;
}

/** §4: DPR above 2 triples fill cost for no perceptible gain on flat shapes. */
export function clampDpr(dpr: number): number {
  if (Number.isFinite(dpr) === false || dpr <= 0) return 1;
  return Math.min(dpr, MAX_DPR);
}

/* ------------------------------------------------------------------ target */

const NO_DASH: number[] = [];
const TAU = Math.PI * 2;

export function createCanvasTarget(canvas: CanvasLike): RenderTarget {
  const ctx2d = canvas.getContext('2d');
  if (ctx2d === null) throw new Error('canvas-engine: 2D context unavailable');
  const ctx = ctx2d;

  const size = { width: 0, height: 0 };
  let dpr = 1;
  let camera: CameraState = { x: 0, y: 0, zoom: 1 };
  // One measurement cache per target: it is keyed by font, and font metrics are per-context.
  const widths = createLru<number>(TEXT_CACHE_LIMIT);
  // ctx.font assignment triggers font matching; only write it when it actually changes (§6.9).
  let currentFont = '';
  const dash: number[] = [];

  const setFont = (font: string): void => {
    if (font !== currentFont) {
      ctx.font = font;
      currentFont = font;
    }
  };

  const applyBase = (): void => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const paint = (fill: RGBA | null, stroke: RGBA | null, strokeWidth: number): void => {
    if (fill !== null) {
      ctx.fillStyle = cssColor(fill);
      ctx.fill();
    }
    if (stroke !== null) {
      ctx.strokeStyle = cssColor(stroke);
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  };

  const draw: DrawContext = {
    clear(color: RGBA): void {
      ctx.save();
      applyBase();
      ctx.fillStyle = cssColor(color);
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.restore();
    },
    save(): void {
      ctx.save();
    },
    restore(): void {
      ctx.restore();
      currentFont = '';
    },
    setCamera(next: CameraState): void {
      camera = next;
      const s = dpr * next.zoom;
      // world → screen (§4): sx = (wx - camera.x) * zoom, then device scale.
      ctx.setTransform(s, 0, 0, s, -next.x * s, -next.y * s);
    },
    rect(r: Rect, fill: RGBA | null, stroke: RGBA | null, strokeWidth = 1): void {
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x + r.w, r.y);
      ctx.lineTo(r.x + r.w, r.y + r.h);
      ctx.lineTo(r.x, r.y + r.h);
      ctx.lineTo(r.x, r.y);
      paint(fill, stroke, strokeWidth);
    },
    roundRect(r: Rect, radius: number, fill: RGBA | null, stroke: RGBA | null, strokeWidth = 1) {
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, radius);
      paint(fill, stroke, strokeWidth);
    },
    line(a: Vec2, b: Vec2, color: RGBA, width: number, dashPattern?: readonly number[] | null) {
      if (dashPattern === undefined || dashPattern === null) {
        ctx.setLineDash(NO_DASH);
      } else {
        dash.length = 0;
        for (const d of dashPattern) dash.push(d);
        ctx.setLineDash(dash);
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = cssColor(color);
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
    },
    dot(p: Vec2, radius: number, color: RGBA): void {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, TAU);
      ctx.fillStyle = cssColor(color);
      ctx.fill();
    },
    text(p: Vec2, value: string, color: RGBA, font: string, maxWidth: number): void {
      setFont(font);
      ctx.textBaseline = 'middle';
      ctx.fillStyle = cssColor(color);
      ctx.fillText(truncateHard(value), p.x, p.y, maxWidth);
    },
    measureText(value: string, font: string): number {
      const key = `${font}|${value}`;
      const hit = widths.get(key);
      if (hit !== undefined) return hit;
      setFont(font);
      const w = ctx.measureText(value).width;
      widths.set(key, w);
      return w;
    },
  };

  return {
    get size(): { width: number; height: number } {
      return size;
    },
    get dpr(): number {
      return dpr;
    },
    resize(width: number, height: number, nextDpr: number): void {
      const d = clampDpr(nextDpr);
      if (width === size.width && height === size.height && d === dpr) return;
      size.width = width;
      size.height = height;
      dpr = d;
      // §4: backing store in device px, CSS box in CSS px, transform applied exactly once here.
      canvas.width = Math.round(width * d);
      canvas.height = Math.round(height * d);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      applyBase();
      currentFont = '';
      // Metrics are DPR-independent (CSS px), so the width cache survives a resize.
    },
    beginFrame(): DrawContext {
      ctx.save();
      applyBase();
      currentFont = '';
      draw.setCamera(camera);
      return draw;
    },
    endFrame(): void {
      ctx.restore();
      currentFont = '';
    },
    dispose(): void {
      widths.clear();
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
