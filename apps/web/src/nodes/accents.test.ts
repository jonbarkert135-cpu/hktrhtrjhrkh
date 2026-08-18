/**
 * The one place where a design token becomes a canvas colour (P4 §14). If this drifts, every node
 * on the board is painted in the fallback grey and nothing else fails — hence the explicit tests.
 */

import { builtinNodeTypes } from '@nexus/domain';
import { tokens } from '@nexus/ui';
import { beforeEach, describe, expect, it } from 'vitest';

import { accentFor, clearAccentCache, glyphForType, hexToRgba } from './accents.ts';

describe('hexToRgba', () => {
  it('converts a 6-digit hex to 0..1 channels', () => {
    expect(hexToRgba('#ffffff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(hexToRgba('#000000', 0.5)).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    const mid = hexToRgba('#7fa6d9');
    expect(mid?.r).toBeCloseTo(0.498, 2);
  });

  it('returns null for anything else', () => {
    expect(hexToRgba('rebeccapurple')).toBeNull();
    expect(hexToRgba('#fff')).toBeNull();
  });
});

describe('accentFor', () => {
  beforeEach(() => {
    clearAccentCache();
  });

  it('resolves an entity token to its palette colour', () => {
    const accent = accentFor({ colorToken: '--entity-page-fg', icon: 'globe', shape: 'rounded' });
    expect(accent).toEqual(hexToRgba(tokens.color.entity.page));
  });

  it('falls back to neutral grey for an unknown token', () => {
    const accent = accentFor({ colorToken: '--not-a-token', icon: 'x', shape: 'rounded' });
    expect(accent).toEqual({ r: 0.55, g: 0.6, b: 0.68, a: 1 });
  });

  it('memoises by token', () => {
    const glyph = { colorToken: '--entity-repo-fg', icon: 'git-branch', shape: 'rounded' } as const;
    expect(accentFor(glyph)).toBe(accentFor(glyph));
  });

  it('resolves a colour for every registered node type', () => {
    for (const def of builtinNodeTypes().list()) {
      const accent = accentFor(def.glyph);
      expect(accent.a).toBe(1);
      expect(accent).not.toEqual({ r: 0.55, g: 0.6, b: 0.68, a: 1 });
    }
  });
});

describe('glyphForType', () => {
  it('returns the type glyph and falls back to unknown', () => {
    expect(glyphForType('website').icon).toBe('globe');
    expect(glyphForType('type-from-the-future').icon).toBe(
      builtinNodeTypes().get('unknown').glyph.icon,
    );
  });
});
