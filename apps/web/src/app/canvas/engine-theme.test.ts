import { describe, expect, it, vi } from 'vitest';

import { resolveEngineTheme } from './engine-theme';

function element(tokens: Record<string, string>): Element {
  const el = document.createElement('div');
  for (const [name, value] of Object.entries(tokens)) el.style.setProperty(name, value);
  return el;
}

/** Stands in for the 1×1 probe canvas: returns the pixel the browser would have painted. */
function probe(pixel: [number, number, number, number]): CanvasRenderingContext2D {
  const fake = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
    getImageData: () => ({ data: new Uint8ClampedArray(pixel) }),
  };
  return fake as unknown as CanvasRenderingContext2D;
}

describe('resolveEngineTheme', () => {
  it('parses hex and rgb tokens without touching the canvas', () => {
    const { theme } = resolveEngineTheme(
      element({ '--canvas-void': '#101418', '--canvas-edge': 'rgba(120, 130, 145, 0.5)' }),
      null,
    );

    expect(theme.canvasBackground).toEqual({ r: 16, g: 20, b: 24, a: 1 });
    expect(theme.edgeStroke).toEqual({ r: 120, g: 130, b: 145, a: 0.5 });
  });

  it('expands 3- and 4-digit hex', () => {
    const { theme } = resolveEngineTheme(element({ '--canvas-void': '#abc' }), null);
    expect(theme.canvasBackground).toEqual({ r: 170, g: 187, b: 204, a: 1 });
  });

  it('falls back to the canvas for color-mix() and oklch() tokens', () => {
    const { theme } = resolveEngineTheme(
      element({ '--canvas-grid-dot': 'color-mix(in oklab, #fff 6%, transparent)' }),
      probe([255, 255, 255, 15]),
    );

    expect(theme.gridDot.r).toBe(255);
    expect(theme.gridDot.a).toBeCloseTo(15 / 255, 5);
  });

  it('reports a token it cannot resolve instead of inventing a color', () => {
    const unresolved = vi.fn();
    const { theme } = resolveEngineTheme(
      element({ '--canvas-void': 'not-a-color' }),
      probe([0, 0, 0, 0]),
      unresolved,
    );

    expect(unresolved).toHaveBeenCalledWith('--canvas-void', 'not-a-color');
    expect(theme.canvasBackground).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('builds the title font and the numeric metrics from the scales', () => {
    const { theme, metrics } = resolveEngineTheme(
      element({
        '--nx-text-sm': '13px',
        '--nx-font-sans': 'Inter, sans-serif',
        '--nx-radius-3': '10px',
      }),
      null,
    );

    expect(theme.titleFont).toBe('13px Inter, sans-serif');
    expect(metrics.nodeRadius).toBe(10);
    // Missing tokens keep the documented fallback rather than collapsing to zero.
    expect(metrics.titlePadding).toBe(8);
  });
});
