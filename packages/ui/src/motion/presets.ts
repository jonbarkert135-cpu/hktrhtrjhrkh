/**
 * Motion presets for `motion` (framer-motion) UI chrome. Durations are seconds because
 * that is the unit `motion` takes; the values are the token scale divided by 1000, so
 * `tokens.ts` stays the single source. Exits are 0.75x the enter duration (04 §8.1).
 */
import { tokens } from '../tokens/tokens';

const seconds = (ms: string): number => Number(ms.replace('ms', '')) / 1000;

export const duration = {
  1: seconds(tokens.dur['1']),
  2: seconds(tokens.dur['2']),
  3: seconds(tokens.dur['3']),
  4: seconds(tokens.dur['4']),
  5: seconds(tokens.dur['5']),
} as const;

/** Cubic-bezier control points, matching `--nx-ease-*` exactly. */
export const easing = {
  standard: [0.2, 0, 0, 1],
  out: [0.16, 1, 0.3, 1],
  in: [0.7, 0, 0.84, 0],
  inout: [0.65, 0, 0.35, 1],
} as const;

/** Menus, popovers, tooltips: fade + a 2% scale, entering with `ease-out`. */
export const overlayEnter = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
  transition: { duration: duration[3], ease: easing.out },
} as const;

/** Dialogs and sheets: slightly longer, with an 8px rise. */
export const dialogEnter = {
  initial: { opacity: 0, scale: 0.97, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 8 },
  transition: { duration: duration[4], ease: easing.out },
} as const;

/** Hover/press colour changes. */
export const stateChange = { duration: duration[1], ease: easing.standard } as const;
