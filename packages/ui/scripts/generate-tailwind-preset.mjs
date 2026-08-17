/**
 * Generates `tailwind/preset.generated.js` from `src/tokens/tokens.ts`.
 * The preset emits only `var(--…)` references, so Tailwind classes and raw CSS can
 * never drift apart. Run with `--check` (CI) to fail when the committed file is stale.
 *
 * Usage: node scripts/generate-tailwind-preset.mjs [--check]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '..', 'tailwind', 'preset.generated.js');

// ponytail: tokens.ts is imported through Node's built-in type stripping (Node >= 22.6)
// instead of adding a TS build step for one script. Ceiling: tokens.ts must stay
// syntax-strippable (no enums/namespaces/decorators). Upgrade path: run it through tsx.
const { tokens, flatTokens } = await import('../src/tokens/tokens.ts');

const varOf = (path) => `var(${flatTokens[path].name})`;

function group(prefix) {
  const out = {};
  for (const path of Object.keys(flatTokens)) {
    if (!path.startsWith(`${prefix}.`)) continue;
    out[path.slice(prefix.length + 1).replaceAll('.', '-')] = varOf(path);
  }
  return out;
}

const colors = {};
for (const [family, entries] of Object.entries(tokens.color)) {
  colors[family] = Object.fromEntries(
    Object.keys(entries).map((step) => [step, varOf(`color.${family}.${step}`)]),
  );
}
// Semantic roles are what components actually use; they are CSS-only (mixes), so the
// preset references the role variable directly rather than a primitive.
const semanticColors = {
  surface: {
    0: 'var(--surface-0)',
    1: 'var(--surface-1)',
    2: 'var(--surface-2)',
    3: 'var(--surface-3)',
    4: 'var(--surface-4)',
    inset: 'var(--surface-inset)',
    hover: 'var(--surface-hover)',
    active: 'var(--surface-active)',
    selected: 'var(--surface-selected)',
  },
  fg: {
    primary: 'var(--fg-primary)',
    secondary: 'var(--fg-secondary)',
    muted: 'var(--fg-muted)',
    disabled: 'var(--fg-disabled)',
    inverse: 'var(--fg-inverse)',
    accent: 'var(--fg-accent)',
    'on-accent': 'var(--fg-on-accent)',
  },
  border: {
    subtle: 'var(--border-subtle)',
    default: 'var(--border-default)',
    strong: 'var(--border-strong)',
    accent: 'var(--border-accent)',
    focus: 'var(--border-focus)',
    danger: 'var(--border-danger)',
  },
};

const preset = {
  theme: {
    extend: {
      colors: { ...colors, ...semanticColors },
      spacing: group('space'),
      borderRadius: group('radius'),
      borderWidth: group('border'),
      boxShadow: group('shadow'),
      transitionDuration: group('dur'),
      transitionTimingFunction: group('ease'),
      zIndex: group('z'),
      height: group('size'),
      fontFamily: { sans: varOf('font.sans'), mono: varOf('font.mono') },
      fontWeight: group('weight'),
    },
  },
};

const raw = `// GENERATED FILE — do not edit.
// Source: packages/ui/src/tokens/tokens.ts
// Regenerate: pnpm --filter @nexus/ui build   (CI runs it with --check)
export default ${JSON.stringify(preset, null, 2)};
`;

// ponytail: formatted with the repo's own prettier (a root devDependency, resolved by
// node_modules walk-up) so `prettier --check` in CI never fights the generator.
// Ceiling: @nexus/ui does not declare prettier. Upgrade path: add it to devDependencies.
const prettier = await import('prettier');
const options = (await prettier.resolveConfig(outFile)) ?? {};
const body = await prettier.format(raw, { ...options, filepath: outFile });

if (process.argv.includes('--check')) {
  const current = await readFile(outFile, 'utf8').catch(() => '');
  if (current !== body) {
    console.error(
      'tailwind/preset.generated.js is stale. Run `pnpm --filter @nexus/ui build` and commit the result.',
    );
    process.exit(1);
  }
  console.log('tailwind preset is up to date.');
} else {
  await writeFile(outFile, body);
  console.log(`wrote ${outFile}`);
}
