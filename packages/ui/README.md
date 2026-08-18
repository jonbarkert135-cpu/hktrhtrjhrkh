# @nexus/ui

Design tokens, accessible primitives and motion presets for Raven. Source-only package: no
build output, consumers (Vite / vitest / tsx) compile `src/*.ts(x)` directly. The one build
step is `pnpm --filter @nexus/ui build`, which regenerates the Tailwind preset from the tokens.

Normative source for everything here: `RAVEN-SPEC/04_DESIGN_SYSTEM.md`.

## Using it

```ts
import '@nexus/ui/tokens.css'; // once, at the app entry — variables + base element styles
import { Button, Field, Banner, Dialog } from '@nexus/ui';
```

Tailwind: `presets: [require('@nexus/ui/tailwind-preset')]` (ESM default export). The preset
only emits `var(--…)` references, so Tailwind classes and raw CSS can never disagree.

## Token rules

1. **Never a raw value in a component.** No hex, no `rgb()`, no `12px`, no `180ms` in TSX,
   `className` or `style`. `0`, `1px` borders and `100%` are the only exceptions. The ESLint rule
   `@nexus/no-hardcoded-design-values` (owned by `@nexus/config`) fails the build otherwise.
2. **Three tiers.** Tier 1 primitives (`--nx-*`) are theme-independent and must never be read by
   a component. Tier 2 semantic roles (`--surface-2`, `--fg-primary`, `--border-focus`) are what
   components read. Tier 3 component tokens (`--btn-*`, `--input-*`, …) are defined only in terms
   of Tier 2 and live in `src/tokens/components.css`.
3. **Elevation is a recipe, not a property.** Use `.nx-elev-1…4` — background + border + shadow
   together. This is what lets the light theme land in P16 with zero component diffs.
4. **Dark is the only theme in P1.** Roles are already scoped to `:root, [data-theme='dark']`;
   adding light means adding one `[data-theme='light']` block, nothing else.

## File map

```text
src/tokens/color.css       Tier 1 colour ramps + all Tier 2 semantic roles (dark)
src/tokens/space.css       spacing scale, control heights, icon grid
src/tokens/radius.css      radii + border widths
src/tokens/typography.css  font stacks, weights, the 9-step type scale, tracking
src/tokens/elevation.css   shadows + .nx-elev-1..4
src/tokens/motion.css      durations + easings
src/tokens/z-index.css     the stacking ladder
src/tokens/components.css  Tier 3 tokens for the primitives P1 ships
src/tokens/index.css       imports the above + reset, body, :focus-visible, reduced motion
src/tokens/tokens.ts       typed mirror of the values + cssVar()/tokenValue()
src/primitives/            Button, Input/Field, Banner, Skeleton, Spinner, Dialog, Menu,
                           Tooltip, VisuallyHidden, SkipToContent (+ primitives.css)
src/motion/presets.ts      durations/easings/variants for `motion`
tailwind/preset.generated.js  GENERATED — do not edit
```

## Adding a token

1. Add it to the right `src/tokens/*.css` file, at the correct tier.
2. If it is a Tier 1 value that code, tests or Tailwind need, mirror it in `src/tokens/tokens.ts`
   with the **exact same value**. If it is a new semantic colour role bound to a flat primitive,
   add it to `semanticDark` there too — `test/contrast.test.ts` reads that map.
3. Run `pnpm --filter @nexus/ui build` to regenerate the Tailwind preset and commit the result.
4. New text/UI colour roles must clear their contrast threshold (4.5:1 text, 3:1 UI); the
   contrast test enforces it from `tokens.ts`.

## How the preset is generated

`scripts/generate-tailwind-preset.mjs` imports `src/tokens/tokens.ts` (through Node's built-in
type stripping — keep that file free of enums/namespaces/decorators), flattens it to CSS variable
names and writes `tailwind/preset.generated.js`, formatted with the repo's prettier config. The
generated file is committed so `pnpm dev` works before any build; CI runs
`node scripts/generate-tailwind-preset.mjs --check`, which fails if the committed file is stale.
A token therefore exists in exactly one place: the generator is the only thing allowed to
duplicate it.

## Accessibility contract

- Focus is never removed: `:focus-visible` draws `--focus-ring-shadow` (2px ring, 2px offset)
  outside the box; components set `outline: none` only alongside that ring.
- `Field` wires `aria-describedby` to both description and error, sets `aria-invalid`, and keeps
  the error in a `role="alert"` region.
- `Banner` carries a per-kind glyph and label, so status is never colour alone.
- `Button` in `loading` state sets `aria-busy`, stays disabled and keeps its label.
- `Skeleton` and `Spinner` drop their animation under `prefers-reduced-motion`.
- `SkipToContent` is the first tab stop of the app shell (`03_UX.md` §19.1).

## Checks

```bash
pnpm --filter @nexus/ui test       # contrast maths (N6) + one render test per stateful primitive
pnpm --filter @nexus/ui typecheck
pnpm --filter @nexus/ui build      # regenerate the preset
```
