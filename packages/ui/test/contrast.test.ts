import { describe, expect, it } from 'vitest';
import { semanticDark, tokenValue } from '../src/tokens/tokens';
import type { SemanticRole } from '../src/tokens/tokens';

/** WCAG 2.x relative luminance + contrast ratio, computed from the sRGB hexes. */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const int = Number.parseInt(m[1], 16);
  return (
    0.2126 * channel((int >> 16) & 0xff) +
    0.7152 * channel((int >> 8) & 0xff) +
    0.0722 * channel(int & 0xff)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const hex = (role: SemanticRole): string => tokenValue(semanticDark[role]);

const SURFACES: SemanticRole[] = [
  'surface-0',
  'surface-1',
  'surface-2',
  'surface-3',
  'surface-4',
  'surface-inset',
];

/** Text roles that must clear AA body text (4.5:1) on every surface.
 *  `fg-disabled` is exempt (WCAG 1.4.3); `fg-muted` is AA on S0–S3 only and is
 *  therefore restricted to non-S4 surfaces by the design system (04 §4.5). */
const TEXT_ROLES: SemanticRole[] = [
  'fg-primary',
  'fg-secondary',
  'fg-accent',
  'status-info-fg',
  'status-success-fg',
  'status-warn-fg',
  'status-danger-fg',
];

/** Non-text UI (focus ring, selected border, error border) needs 3:1 against any surface
 *  it can be drawn on. `accent-solid` is a *fill*, not a boundary — it is checked below
 *  against the text that sits on it instead. */
const UI_ROLES: SemanticRole[] = ['border-focus', 'border-accent', 'border-danger'];

describe('token contrast (N6)', () => {
  it.each(TEXT_ROLES.flatMap((fg) => SURFACES.map((bg) => [fg, bg] as const)))(
    '%s on %s is AA text',
    (fg, bg) => {
      expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
    },
  );

  // `fg-muted` is the ramp's floor for text: AA on surfaces 0-2 and inset, and only
  // large text / non-text on surfaces 3-4 (04 §4.5 lists 4.44 on S3, 3.92 on S4).
  it.each(['surface-0', 'surface-1', 'surface-2', 'surface-inset'] as const)(
    'fg-muted on %s is AA text',
    (bg) => {
      expect(contrast(hex('fg-muted'), hex(bg))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['surface-3', 'surface-4'] as const)('fg-muted on %s is AA non-text', (bg) => {
    expect(contrast(hex('fg-muted'), hex(bg))).toBeGreaterThanOrEqual(3);
  });

  it.each(UI_ROLES.flatMap((ui) => SURFACES.map((bg) => [ui, bg] as const)))(
    '%s on %s is AA non-text',
    (ui, bg) => {
      expect(contrast(hex(ui), hex(bg))).toBeGreaterThanOrEqual(3);
    },
  );

  it('text on solid accent and inverse fills clears AA', () => {
    expect(contrast(hex('fg-on-accent'), hex('accent-solid'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex('fg-on-accent'), hex('accent-solid-active'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex('fg-inverse'), hex('fg-primary'))).toBeGreaterThanOrEqual(4.5);
  });
});
