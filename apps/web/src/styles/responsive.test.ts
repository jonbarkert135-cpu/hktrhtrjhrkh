// §25 — the responsive layout lives entirely in CSS, so this guards the breakpoints themselves:
// a refactor that drops the mobile block would otherwise ship an unusable phone layout silently.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Path is relative to the package cwd on purpose: `import.meta.url` + readFileSync is unreliable
// under the jsdom environment.
const css = readFileSync('src/styles/app.css', 'utf8');

describe('responsive layout (§25)', () => {
  it('has the laptop, tablet and mobile breakpoints', () => {
    for (const width of ['1280px', '1024px', '720px']) {
      expect(css).toContain(`@media (max-width: ${width})`);
    }
  });

  it('turns the inspector into a bottom sheet on mobile', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 720px)'));
    expect(mobile).toContain('.nx-board-main > .nx-inspector');
    expect(mobile).toContain('inset: auto 0 0 0');
    expect(mobile).toContain('min-height: 44px');
  });
});
