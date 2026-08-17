/**
 * Design tokens → engine theme (05_CANVAS_ENGINE.md §3.1, 04_DESIGN_SYSTEM.md).
 *
 * The engine never reads CSS variables at draw time, so the host resolves every token here, once,
 * and re-resolves it when the color scheme changes. Tokens use `color-mix()` and custom properties,
 * which no regexp can evaluate — the reliable resolver is the browser itself, so a value that is not
 * plainly `rgb()`/`#hex` is painted into a 1×1 canvas and read back.
 */

import type { EngineTheme, RGBA } from '@nexus/canvas-engine';
import type { RenderMetrics } from '@nexus/canvas-engine';

const HEX = /^#([0-9a-f]{3,8})$/i;
const RGB = /^rgba?\(([^)]+)\)$/i;

/** Reported instead of guessing a color, so an unresolvable token is visible, not silently wrong. */
export type UnresolvedReporter = (token: string, value: string) => void;

const FALLBACK: RGBA = { r: 0, g: 0, b: 0, a: 0 };

function parsePlain(value: string): RGBA | null {
  const text = value.trim();
  const hex = HEX.exec(text);
  if (hex) {
    const digits = hex[1] ?? '';
    const wide = digits.length <= 4;
    const size = wide ? 1 : 2;
    const at = (i: number): number => {
      const part = digits.slice(i * size, i * size + size);
      const full = wide ? part + part : part;
      return Number.parseInt(full, 16);
    };
    const alpha = digits.length === 4 || digits.length === 8 ? at(3) / 255 : 1;
    return { r: at(0), g: at(1), b: at(2), a: alpha };
  }
  const rgb = RGB.exec(text);
  if (rgb) {
    const parts = (rgb[1] ?? '')
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    const [r, g, b, a] = parts;
    if (r === undefined || g === undefined || b === undefined) return null;
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b, a: a === undefined || Number.isNaN(a) ? 1 : a };
  }
  return null;
}

/**
 * Last resort for `color-mix()`, `oklch()` and friends: let the canvas do the color math. An
 * invalid value leaves `fillStyle` untouched, so the cleared (fully transparent) pixel survives and
 * is reported as unresolved — a token that genuinely resolves to transparent gets the same value
 * either way, so nothing is painted wrong.
 */
function parseViaCanvas(value: string, probe: CanvasRenderingContext2D | null): RGBA | null {
  if (probe === null) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const data = probe.getImageData(0, 0, 1, 1).data;
  const [r, g, b, a] = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
  if (a === 0) return null;
  return { r, g, b, a: a / 255 };
}

export interface ThemeResolver {
  color(token: string): RGBA;
  size(token: string, fallback: number): number;
  font(): string;
}

export function createThemeResolver(
  element: Element,
  probe: CanvasRenderingContext2D | null,
  onUnresolved: UnresolvedReporter = () => undefined,
): ThemeResolver {
  const styles = getComputedStyle(element);
  const read = (token: string): string => styles.getPropertyValue(token).trim();

  return {
    color(token: string): RGBA {
      const value = read(token);
      const parsed = parsePlain(value) ?? parseViaCanvas(value, probe);
      if (parsed === null) {
        onUnresolved(token, value);
        return FALLBACK;
      }
      return parsed;
    },
    size(token: string, fallback: number): number {
      const value = Number.parseFloat(read(token));
      return Number.isFinite(value) ? value : fallback;
    },
    font(): string {
      // `medium` is the CSS keyword default: a missing token must not produce an invalid font
      // shorthand, and hardcoding a px size here would be a design value in code.
      const size = read('--nx-text-sm') || 'medium';
      const family = read('--nx-font-sans') || 'system-ui, sans-serif';
      return `${size} ${family}`;
    },
  };
}

export interface ResolvedTheme {
  theme: EngineTheme;
  metrics: RenderMetrics;
}

/**
 * Every canvas color comes from a `--canvas-*` / `--selection-*` token; the numeric metrics come
 * from the radius and space scales. Nothing here is a literal design value except the documented
 * fallbacks used when a token is missing from the stylesheet.
 */
export function resolveEngineTheme(
  element: Element,
  probe: CanvasRenderingContext2D | null,
  onUnresolved?: UnresolvedReporter,
): ResolvedTheme {
  const t = createThemeResolver(element, probe, onUnresolved);
  return {
    theme: {
      canvasBackground: t.color('--canvas-void'),
      gridDot: t.color('--canvas-grid-dot'),
      gridLine: t.color('--canvas-grid-line'),
      nodeFill: t.color('--surface-1'),
      nodeStroke: t.color('--border-subtle'),
      nodeTitle: t.color('--fg-primary'),
      selectionStroke: t.color('--selection-ring'),
      marqueeStroke: t.color('--selection-ring'),
      marqueeFill: t.color('--canvas-marquee-fill'),
      guideStroke: t.color('--canvas-guide'),
      edgeStroke: t.color('--canvas-edge'),
      minimapViewport: t.color('--selection-ring'),
      minimapNode: t.color('--canvas-edge-strong'),
      titleFont: t.font(),
      selectionWidth: t.size('--nx-border-2', 1.5),
    },
    metrics: {
      nodeRadius: t.size('--nx-radius-3', 8),
      accentStripe: t.size('--nx-border-2', 2),
      statusDot: t.size('--nx-border-3', 3),
      titlePadding: t.size('--nx-space-3', 8),
      handleSize: t.size('--nx-space-3', 8),
      densityBlob: t.size('--nx-space-2', 6),
      guideDash: t.size('--nx-space-2', 4),
    },
  };
}
