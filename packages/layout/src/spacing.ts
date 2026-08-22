/**
 * Spacing tokens. These are layout geometry, not design tokens: they are expressed in board units
 * (the same units node `w`/`h` use) and are the only magic numbers the algorithms are allowed to
 * read. They follow the 8-unit rhythm of `04_DESIGN_SYSTEM.md` so a laid-out board still snaps to
 * the canvas grid.
 */

export const SPACING = {
  /** Gap between siblings along the primary axis. */
  nodeGap: 48,
  /** Gap between ranks (layers, rings, lanes). */
  rankGap: 96,
  /** Gap between two connected components / clusters. */
  clusterGap: 160,
  /** Minimum clearance enforced by the overlap-separation pass. */
  minClearance: 16,
  /** Grid the final positions are snapped to, so nudges and guides keep working. */
  grid: 8,
} as const;

export function snap(value: number, grid: number = SPACING.grid): number {
  return Math.round(value / grid) * grid;
}
