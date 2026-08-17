import { describe, expect, it, vi } from 'vitest';
import { createFpsSampler, drawGrid, resizeToDisplay } from './grid';

function fakeCanvas(clientWidth: number, clientHeight: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: clientWidth });
  Object.defineProperty(canvas, 'clientHeight', { value: clientHeight });
  return canvas;
}

describe('resizeToDisplay', () => {
  it('scales the backing store by the device pixel ratio', () => {
    vi.stubGlobal('devicePixelRatio', 1.5);
    const canvas = fakeCanvas(200, 100);
    expect(resizeToDisplay(canvas)).toBe(1.5);
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
  });

  it('caps the ratio at 2 and never sizes below one pixel', () => {
    vi.stubGlobal('devicePixelRatio', 4);
    const canvas = fakeCanvas(0, 0);
    expect(resizeToDisplay(canvas)).toBe(2);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });
});

describe('drawGrid', () => {
  it('fills the void and draws a line per 32 css px, wrapping negative camera offsets', () => {
    const calls: { x: number; y: number }[] = [];
    const fillRect = vi.fn();
    const ctx = {
      canvas: { width: 128, height: 64 },
      setTransform: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      fillRect,
      beginPath: vi.fn(),
      moveTo: vi.fn((x: number, y: number) => calls.push({ x, y })),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawGrid(ctx, { x: -8, y: 0 }, 1, { void: '#000', line: '#111' });

    expect(fillRect).toHaveBeenCalledWith(0, 0, 128, 64);
    expect(ctx.fillStyle).toBe('#000');
    expect(ctx.strokeStyle).toBe('#111');
    // verticals start at (-8 mod 32) = 24, then every 32 px; horizontals start at 0.
    expect(calls).toEqual([
      { x: 24.5, y: 0 },
      { x: 56.5, y: 0 },
      { x: 88.5, y: 0 },
      { x: 120.5, y: 0 },
      { x: 0, y: 0.5 },
      { x: 0, y: 32.5 },
    ]);
  });
});

describe('createFpsSampler', () => {
  it('reports zeroes before any frame', () => {
    expect(createFpsSampler().metrics()).toEqual({ fps: 0, p95FrameMs: 0, frames: 0 });
  });

  it('averages frame times into fps and reports the p95', () => {
    const sampler = createFpsSampler();
    for (let i = 0; i < 100; i += 1) sampler.sample(i < 95 ? 10 : 50);
    expect(sampler.metrics()).toEqual({ fps: 1000 / 12, p95FrameMs: 50, frames: 100 });
  });

  it('keeps at most 240 samples', () => {
    const sampler = createFpsSampler();
    for (let i = 0; i < 300; i += 1) sampler.sample(20);
    expect(sampler.metrics()).toEqual({ fps: 50, p95FrameMs: 20, frames: 240 });
  });
});
