/**
 * Deterministic randomness. `Math.random` is banned in this package: a layout that cannot be
 * reproduced cannot be previewed, tested or explained (00_MASTER.md §3.3).
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  between(min: number, max: number): number;
}

export const DEFAULT_SEED = 0x5eed;

/** mulberry32 — 32 bits of state, excellent distribution for a layout jitter, 4 lines long. */
export function createRng(seed: number): Rng {
  let state = (seed | 0) === 0 ? DEFAULT_SEED : seed | 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, between: (min, max) => min + next() * (max - min) };
}

/**
 * A stable 32-bit hash of a string. Used where a node needs a reproducible pseudo-random value
 * that does not depend on its position in the input array (so adding a node elsewhere does not
 * reshuffle everything — the stability property the tests assert).
 */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
