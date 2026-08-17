/**
 * The headless `RenderTarget`: every draw verb becomes a compact plain object, so engine tests
 * assert a draw-command stream instead of pixels (18_TESTING.md §5.1) and scene snapshots are
 * reviewable text (§5.4).
 *
 * Deterministic by construction: `measureText` uses a synthetic metric derived from the font size,
 * never a real font.
 */

import type { CameraState, DrawContext, RGBA, Rect, RenderTarget, Vec2 } from '../types';
import { cssColor } from './target';
import { truncateHard } from './text';

export type DrawCall =
  | { op: 'clear'; color: string }
  | { op: 'save' }
  | { op: 'restore' }
  | { op: 'camera'; x: number; y: number; zoom: number }
  | {
      op: 'rect' | 'roundRect';
      x: number;
      y: number;
      w: number;
      h: number;
      radius: number;
      fill: string | null;
      stroke: string | null;
      width: number;
    }
  | {
      op: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      width: number;
      dash: string | null;
    }
  | { op: 'dot'; x: number; y: number; r: number; color: string }
  | {
      op: 'text';
      x: number;
      y: number;
      value: string;
      color: string;
      font: string;
      maxWidth: number;
    };

export interface RecordingTarget extends RenderTarget {
  readonly calls: readonly DrawCall[];
  readonly frames: number;
  /** Draw calls of one op kind, for order and count assertions. */
  ops(op: DrawCall['op']): readonly DrawCall[];
  reset(): void;
  /** Stable, human-reviewable text form of the recorded frame (18_TESTING.md §5.4). */
  toSnapshot(): string;
}

/** Average glyph advance as a fraction of the font size — close enough for layout assertions. */
const ADVANCE_RATIO = 0.55;
const FONT_SIZE_RE = /(\d+(?:\.\d+)?)px/;

/** Deterministic stand-in for `ctx.measureText`, exported so tests can predict clipping. */
export function estimateTextWidth(value: string, font: string): number {
  const m = FONT_SIZE_RE.exec(font);
  const size = m?.[1] === undefined ? 13 : Number(m[1]);
  return value.length * size * ADVANCE_RATIO;
}

const n = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2));

export function createRecordingTarget(width = 1440, height = 900, dprValue = 1): RecordingTarget {
  const calls: DrawCall[] = [];
  const size = { width, height };
  let dpr = dprValue;
  let frames = 0;
  let camera: CameraState = { x: 0, y: 0, zoom: 1 };

  const draw: DrawContext = {
    clear(color: RGBA): void {
      calls.push({ op: 'clear', color: cssColor(color) });
    },
    save(): void {
      calls.push({ op: 'save' });
    },
    restore(): void {
      calls.push({ op: 'restore' });
    },
    setCamera(next: CameraState): void {
      camera = next;
      calls.push({ op: 'camera', x: next.x, y: next.y, zoom: next.zoom });
    },
    rect(r: Rect, fill: RGBA | null, stroke: RGBA | null, strokeWidth = 1): void {
      calls.push(shape('rect', r, 0, fill, stroke, strokeWidth));
    },
    roundRect(r: Rect, radius: number, fill: RGBA | null, stroke: RGBA | null, strokeWidth = 1) {
      calls.push(shape('roundRect', r, radius, fill, stroke, strokeWidth));
    },
    line(a: Vec2, b: Vec2, color: RGBA, lineWidth: number, dash?: readonly number[] | null): void {
      calls.push({
        op: 'line',
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        color: cssColor(color),
        width: lineWidth,
        dash: dash === undefined || dash === null ? null : dash.join(','),
      });
    },
    dot(p: Vec2, radius: number, color: RGBA): void {
      calls.push({ op: 'dot', x: p.x, y: p.y, r: radius, color: cssColor(color) });
    },
    text(p: Vec2, value: string, color: RGBA, font: string, maxWidth: number): void {
      calls.push({
        op: 'text',
        x: p.x,
        y: p.y,
        value: truncateHard(value),
        color: cssColor(color),
        font,
        maxWidth,
      });
    },
    measureText(value: string, font: string): number {
      return estimateTextWidth(value, font);
    },
  };

  return {
    get size(): { width: number; height: number } {
      return size;
    },
    get dpr(): number {
      return dpr;
    },
    get calls(): readonly DrawCall[] {
      return calls;
    },
    get frames(): number {
      return frames;
    },
    ops(op: DrawCall['op']): readonly DrawCall[] {
      return calls.filter((c) => c.op === op);
    },
    resize(w: number, h: number, nextDpr: number): void {
      size.width = w;
      size.height = h;
      dpr = nextDpr;
    },
    beginFrame(): DrawContext {
      return draw;
    },
    endFrame(): void {
      frames += 1;
    },
    reset(): void {
      calls.length = 0;
      frames = 0;
    },
    dispose(): void {
      calls.length = 0;
    },
    toSnapshot(): string {
      const lines: string[] = [
        `target ${n(size.width)}x${n(size.height)} dpr ${n(dpr)}`,
        `camera ${n(camera.x)},${n(camera.y)} @${camera.zoom.toFixed(2)}`,
      ];
      for (const c of calls) lines.push(describe(c));
      lines.push(`calls ${calls.length} frames ${frames}`);
      return lines.join('\n');
    },
  };
}

function shape(
  op: 'rect' | 'roundRect',
  r: Rect,
  radius: number,
  fill: RGBA | null,
  stroke: RGBA | null,
  width: number,
): DrawCall {
  return {
    op,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    radius,
    fill: fill === null ? null : cssColor(fill),
    stroke: stroke === null ? null : cssColor(stroke),
    width,
  };
}

function describe(c: DrawCall): string {
  switch (c.op) {
    case 'clear':
      return `clear ${c.color}`;
    case 'save':
      return 'save';
    case 'restore':
      return 'restore';
    case 'camera':
      return `camera ${n(c.x)},${n(c.y)} @${c.zoom.toFixed(2)}`;
    case 'rect':
    case 'roundRect':
      return (
        `${c.op} ${n(c.x)},${n(c.y)} ${n(c.w)}x${n(c.h)} r=${n(c.radius)}` +
        ` fill=${c.fill ?? '-'} stroke=${c.stroke ?? '-'} w=${n(c.width)}`
      );
    case 'line':
      return (
        `line ${n(c.x1)},${n(c.y1)}->${n(c.x2)},${n(c.y2)}` +
        ` ${c.color} w=${n(c.width)} dash=${c.dash ?? '-'}`
      );
    case 'dot':
      return `dot ${n(c.x)},${n(c.y)} r=${n(c.r)} ${c.color}`;
    case 'text':
      return `text ${n(c.x)},${n(c.y)} "${c.value}" ${c.color} font=${c.font} max=${n(c.maxWidth)}`;
  }
}
