import { describe, expect, it } from 'vitest';

import { MAX_CANVAS_TEXT, MAX_DPR, TEXT_CACHE_LIMIT } from '../src/constants';
import { createRecordingTarget, estimateTextWidth } from '../src/render/recording-target';
import type { CanvasLike, Context2DLike } from '../src/render/target';
import { clampDpr, createCanvasTarget, cssColor } from '../src/render/target';
import { createLru, createTextCache, ellipsize, sliceSafe, truncateHard } from '../src/render/text';
import { theme } from './render-fixtures';

/** A 2D context stub: no jsdom, no node-canvas — the target only needs these verbs. */
function stubCanvas(): {
  canvas: CanvasLike;
  ops: string[];
  fontWrites: string[];
  measured: string[];
} {
  const ops: string[] = [];
  const fontWrites: string[] = [];
  const measured: string[] = [];
  let font = '';
  const ctx: Context2DLike = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    get font(): string {
      return font;
    },
    set font(value: string) {
      font = value;
      fontWrites.push(value);
    },
    textBaseline: 'alphabetic',
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    setTransform: (a, b, c, d, e, f) => ops.push(`setTransform ${a},${b},${c},${d},${e},${f}`),
    clearRect: () => ops.push('clearRect'),
    fillRect: (x, y, w, h) => ops.push(`fillRect ${x},${y},${w},${h}`),
    strokeRect: () => ops.push('strokeRect'),
    beginPath: () => ops.push('beginPath'),
    moveTo: (x, y) => ops.push(`moveTo ${x},${y}`),
    lineTo: (x, y) => ops.push(`lineTo ${x},${y}`),
    arc: (x, y, r) => ops.push(`arc ${x},${y},${r}`),
    roundRect: (x, y, w, h, r) => ops.push(`roundRect ${x},${y},${w},${h},${r}`),
    fill: () => ops.push('fill'),
    stroke: () => ops.push('stroke'),
    setLineDash: (segments) => ops.push(`setLineDash ${segments.join('|')}`),
    fillText: (text, x, y) => ops.push(`fillText ${text}@${x},${y}`),
    measureText: (text: string) => {
      measured.push(text);
      return { width: estimateTextWidth(text, font) };
    },
  };
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: () => ctx,
  };
  return { canvas, ops, fontWrites, measured };
}

describe('canvas target — DPR', () => {
  it('sizes the backing store in device px and the box in CSS px (05 §4)', () => {
    const { canvas, ops } = stubCanvas();
    const target = createCanvasTarget(canvas);
    target.resize(800, 600, 2);

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
    expect(target.size).toEqual({ width: 800, height: 600 });
    expect(ops).toContain('setTransform 2,0,0,2,0,0');
  });

  it('clamps DPR to MAX_DPR and rounds fractional device sizes', () => {
    const { canvas } = stubCanvas();
    const target = createCanvasTarget(canvas);
    target.resize(801, 601, 3);
    expect(target.dpr).toBe(MAX_DPR);
    expect(canvas.width).toBe(801 * MAX_DPR);

    target.resize(300.4, 200.6, 1.25);
    expect(target.dpr).toBe(1.25);
    expect(canvas.width).toBe(Math.round(300.4 * 1.25));
    expect(canvas.height).toBe(Math.round(200.6 * 1.25));
  });

  it('rejects a nonsensical DPR and re-creates the backing store only on a real change', () => {
    expect(clampDpr(0)).toBe(1);
    expect(clampDpr(Number.NaN)).toBe(1);

    const { canvas, ops } = stubCanvas();
    const target = createCanvasTarget(canvas);
    target.resize(400, 300, 1);
    const writes = ops.filter((o) => o.startsWith('setTransform')).length;
    target.resize(400, 300, 1);
    expect(ops.filter((o) => o.startsWith('setTransform')).length).toBe(writes);
  });

  it('throws when the host hands over a canvas without a 2D context', () => {
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      style: { width: '', height: '' },
      getContext: () => null,
    };
    expect(() => createCanvasTarget(canvas)).toThrow(/2D context/);
  });
});

describe('canvas target — drawing', () => {
  it('applies the camera as one device-space transform (05 §4)', () => {
    const { canvas, ops } = stubCanvas();
    const target = createCanvasTarget(canvas);
    target.resize(100, 100, 2);
    const ctx = target.beginFrame();
    ctx.setCamera({ x: 10, y: 20, zoom: 0.5 });
    // s = dpr * zoom = 1; translation = -camera * s
    expect(ops).toContain('setTransform 1,0,0,1,-10,-20');
    target.endFrame();
  });

  it('writes ctx.font once per frame however many titles are drawn (§6.9)', () => {
    const { canvas, fontWrites } = stubCanvas();
    const target = createCanvasTarget(canvas);
    target.resize(100, 100, 1);
    const ctx = target.beginFrame();
    for (let i = 0; i < 50; i += 1) {
      ctx.text({ x: i, y: i }, `t${i}`, theme.nodeTitle, theme.titleFont, 100);
    }
    expect(fontWrites).toEqual([theme.titleFont]);
    target.endFrame();
  });

  it('memoizes measureText per (font, value)', () => {
    const { canvas, measured } = stubCanvas();
    const target = createCanvasTarget(canvas);
    const ctx = target.beginFrame();
    expect(ctx.measureText('hello', theme.titleFont)).toBeGreaterThan(0);
    ctx.measureText('hello', theme.titleFont);
    ctx.measureText('hello', '20px Inter');
    expect(measured).toEqual(['hello', 'hello']);
  });

  it('hard-truncates canvas text at MAX_CANVAS_TEXT (P2 §9)', () => {
    const { canvas, ops } = stubCanvas();
    const target = createCanvasTarget(canvas);
    const ctx = target.beginFrame();
    ctx.text({ x: 0, y: 0 }, 'x'.repeat(1000), theme.nodeTitle, theme.titleFont, 999);
    const call = ops.find((o) => o.startsWith('fillText'));
    expect(call).toBe(`fillText ${'x'.repeat(MAX_CANVAS_TEXT)}@0,0`);
  });

  it('draws each verb and resets the dash after a dashed line', () => {
    const { canvas, ops } = stubCanvas();
    const target = createCanvasTarget(canvas);
    target.resize(50, 50, 1);
    const ctx = target.beginFrame();
    ctx.clear(theme.canvasBackground);
    ctx.rect({ x: 0, y: 0, w: 10, h: 10 }, theme.nodeFill, theme.nodeStroke, 2);
    ctx.roundRect({ x: 1, y: 1, w: 8, h: 8 }, 4, null, theme.selectionStroke);
    ctx.line({ x: 0, y: 0 }, { x: 5, y: 5 }, theme.edgeStroke, 1, [4, 4]);
    ctx.line({ x: 0, y: 0 }, { x: 5, y: 5 }, theme.edgeStroke, 1, null);
    ctx.dot({ x: 2, y: 2 }, 1.5, theme.gridDot);
    ctx.save();
    ctx.restore();
    target.endFrame();

    expect(ops).toContain('fillRect 0,0,50,50');
    expect(ops).toContain('roundRect 1,1,8,8,4');
    expect(ops).toContain('setLineDash 4|4');
    expect(ops).toContain('arc 2,2,1.5');
    expect(ops.filter((o) => o === 'setLineDash ').length).toBe(3);
    target.dispose();
    expect(canvas.width).toBe(0);
  });

  it('renders colors as rgba and memoizes per color object', () => {
    expect(cssColor(theme.marqueeFill)).toBe('rgba(80,160,255,0.08)');
    expect(cssColor(theme.marqueeFill)).toBe(cssColor(theme.marqueeFill));
  });
});

describe('recording target', () => {
  it('records every verb as a plain object and counts frames', () => {
    const rec = createRecordingTarget(400, 300, 1);
    const ctx = rec.beginFrame();
    ctx.clear(theme.canvasBackground);
    ctx.setCamera({ x: 0, y: 0, zoom: 1 });
    ctx.save();
    ctx.rect({ x: 0, y: 0, w: 4, h: 4 }, theme.nodeFill, null);
    ctx.roundRect({ x: 0, y: 0, w: 4, h: 4 }, 2, null, theme.nodeStroke, 1);
    ctx.line({ x: 0, y: 0 }, { x: 1, y: 1 }, theme.edgeStroke, 1, [2, 2]);
    ctx.dot({ x: 1, y: 1 }, 1, theme.gridDot);
    ctx.text({ x: 0, y: 0 }, 'hi', theme.nodeTitle, theme.titleFont, 40);
    ctx.restore();
    rec.endFrame();

    expect(rec.frames).toBe(1);
    expect(rec.ops('text')).toHaveLength(1);
    expect(rec.toSnapshot()).toContain('text 0,0 "hi"');
    expect(rec.toSnapshot()).toContain('line 0,0->1,1');
    expect(rec.calls.map((c) => c.op)).toEqual([
      'clear',
      'camera',
      'save',
      'rect',
      'roundRect',
      'line',
      'dot',
      'text',
      'restore',
    ]);

    rec.resize(800, 600, 2);
    expect(rec.size.width).toBe(800);
    expect(rec.dpr).toBe(2);
    rec.reset();
    expect(rec.calls).toHaveLength(0);
    rec.dispose();
  });

  it('measures deterministically from the font size', () => {
    const rec = createRecordingTarget();
    const ctx = rec.beginFrame();
    expect(ctx.measureText('abcd', '10px Inter')).toBeCloseTo(4 * 10 * 0.55, 6);
    expect(ctx.measureText('abcd', 'bold Inter')).toBeCloseTo(4 * 13 * 0.55, 6);
  });
});

describe('text cache', () => {
  const measure = (value: string, font: string): number => estimateTextWidth(value, font);

  it('ellipsizes with a binary search and caches the result', () => {
    let calls = 0;
    const counting = (value: string, font: string): number => {
      calls += 1;
      return measure(value, font);
    };
    const cache = createTextCache();
    const out = cache.fit(counting, 'A very long node title indeed', '13px Inter', 60);
    expect(out.endsWith('\u2026')).toBe(true);
    expect(estimateTextWidth(out, '13px Inter')).toBeLessThanOrEqual(60);
    const before = calls;
    expect(cache.fit(counting, 'A very long node title indeed', '13px Inter', 60)).toBe(out);
    expect(calls).toBe(before);
    expect(cache.size).toBeGreaterThan(0);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('returns the value untouched when it already fits, and empty when nothing fits', () => {
    const cache = createTextCache();
    expect(cache.fit(measure, 'ok', '13px Inter', 500)).toBe('ok');
    expect(cache.fit(measure, 'wide title', '13px Inter', 1)).toBe('');
    expect(cache.fit(measure, '', '13px Inter', 0)).toBe('');
    expect(cache.width(measure, 'ok', '13px Inter')).toBeCloseTo(2 * 13 * 0.55, 6);
  });

  it('falls back to a bare ellipsis when only the ellipsis fits', () => {
    const width = (value: string): number => (value === '\u2026' ? 5 : 100);
    expect(ellipsize(width, 'title', 6)).toBe('\u2026');
  });

  it('never splits a surrogate pair', () => {
    const emoji = 'ab\u{1F600}cd';
    expect(sliceSafe(emoji, 3)).toBe('ab');
    expect(sliceSafe(emoji, 4)).toBe('ab\u{1F600}');
    expect(sliceSafe(emoji, 99)).toBe(emoji);
    expect(sliceSafe(emoji, 0)).toBe('');
  });

  it('hard-truncates beyond MAX_CANVAS_TEXT', () => {
    expect(truncateHard('a'.repeat(10))).toHaveLength(10);
    expect(truncateHard('a'.repeat(MAX_CANVAS_TEXT + 50))).toHaveLength(MAX_CANVAS_TEXT);
  });

  it('evicts least-recently-used entries at the limit', () => {
    const lru = createLru<number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1); // 'a' is now the young end
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.size).toBe(2);
    lru.set('a', 9);
    expect(lru.get('a')).toBe(9);
    expect(lru.size).toBe(2);
  });

  it('bounds the shared measure cache at TEXT_CACHE_LIMIT', () => {
    const cache = createTextCache(4);
    for (let i = 0; i < 20; i += 1) cache.width(measure, `t${i}`, '13px Inter');
    expect(cache.size).toBeLessThanOrEqual(4);
    expect(TEXT_CACHE_LIMIT).toBe(2000);
  });
});
