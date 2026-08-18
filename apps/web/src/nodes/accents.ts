/**
 * Token → canvas colour (P4 §14). The engine paints with numbers, the design system speaks in
 * tokens, and node types only ever name a token. This module is the single translation point, so a
 * palette change stays a token change and never becomes a hunt through painters.
 */

import { builtinNodeTypes, type LodGlyph } from '@nexus/domain';
import type { RGBA } from '@nexus/canvas-engine';
import { tokens } from '@nexus/ui';

const FALLBACK: RGBA = { r: 0.55, g: 0.6, b: 0.68, a: 1 };

/** `#a5b8d0` → `{ r, g, b, a }` in 0..1. Returns null for anything that is not a 6-digit hex. */
export function hexToRgba(hex: string, alpha = 1): RGBA | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return null;
  const value = Number.parseInt(match[1] ?? '', 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
    a: alpha,
  };
}

/** `--entity-page-fg` → the entity hue behind it. */
function entityHex(colorToken: string): string | undefined {
  const match = /^--entity-([a-z0-9-]+)-fg$/.exec(colorToken);
  const kind = match?.[1];
  if (kind === undefined) return undefined;
  const palette = tokens.color.entity as Record<string, string | undefined>;
  return palette[kind];
}

const cache = new Map<string, RGBA>();

/** Resolves a glyph colour token to a canvas colour, memoised: painters call this per frame. */
export function accentFor(glyph: LodGlyph): RGBA {
  const cached = cache.get(glyph.colorToken);
  if (cached !== undefined) return cached;
  const hex = entityHex(glyph.colorToken);
  const rgba = hex === undefined ? FALLBACK : (hexToRgba(hex) ?? FALLBACK);
  cache.set(glyph.colorToken, rgba);
  return rgba;
}

/** The glyph a node type contributes; unknown types fall back to the `unknown` definition. */
export function glyphForType(type: string): LodGlyph {
  return builtinNodeTypes().get(type).glyph;
}

/** Test seam: the accent cache is process-wide, so tests that swap the palette must clear it. */
export function clearAccentCache(): void {
  cache.clear();
}
