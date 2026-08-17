/**
 * LOD decisions (05_CANVAS_ENGINE.md §6.8, 20_ROADMAP P2 requirements 6 and 7).
 *
 * Three mechanisms, all needed to stop DOM promotion thrash:
 *   1. a quantized ("efficient") zoom while the camera moves, released LOD_SETTLE_MS after the
 *      last camera event;
 *   2. a hysteresis dead-band around every threshold;
 *   3. one ladder for the whole engine, so canvas and overlay never disagree.
 */

import { LOD_HYSTERESIS, LOD_SETTLE_MS, LOD_THRESHOLDS, LOD_ZOOM_QUANTUM } from '../constants';
import type { EngineClock, LodLevel } from '../types';

/**
 * The painting ladder. `LodLevel` (frozen in types.ts) collapses L1/L2 into `glyph` because the
 * overlay only cares about "is it DOM"; the renderer needs the finer step.
 */
export type PaintLod = 'dot' | 'glyph' | 'glyphText' | 'dom';

/** Ascending; index i is the lower bound of LADDER[i + 1]. */
const LADDER: readonly PaintLod[] = ['dot', 'glyph', 'glyphText', 'dom'];
const BOUNDS: readonly number[] = [
  LOD_THRESHOLDS.glyph,
  LOD_THRESHOLDS.glyphWithText,
  LOD_THRESHOLDS.dom,
];

export function toLodLevel(lod: PaintLod): LodLevel {
  if (lod === 'dom') return 'dom';
  return lod === 'dot' ? 'dot' : 'glyph';
}

/** Nearest LOD_ZOOM_QUANTUM step, rounded down: the "efficient zoom level". */
export function quantizeZoom(zoom: number): number {
  return Math.floor(zoom / LOD_ZOOM_QUANTUM + 1e-9) * LOD_ZOOM_QUANTUM;
}

/** Ladder position with no hysteresis; `previous === null` means "first evaluation". */
export function paintLodFor(zoom: number, previous: PaintLod | null = null): PaintLod {
  const prev = previous === null ? -1 : LADDER.indexOf(previous);
  let index = 0;
  for (let i = 0; i < BOUNDS.length; i += 1) {
    const bound = BOUNDS[i] ?? 0;
    // Climbing needs +band, falling needs -band: inside the band the previous level wins.
    // With no previous level there is nothing to stabilize, so the raw threshold applies.
    const band = previous === null ? 0 : prev <= i ? LOD_HYSTERESIS : -LOD_HYSTERESIS;
    if (zoom >= bound + band) index = i + 1;
  }
  return LADDER[index] ?? 'dot';
}

export interface LodController {
  /** Ladder level for `zoom`, applying the stable zoom and hysteresis; commits the result. */
  levelFor(zoom: number): PaintLod;
  /** The coarse level the overlay and FrameStats use. */
  level(zoom: number): LodLevel;
  /** Call on every camera event: starts/refreshes the quantization window. */
  cameraChanged(): void;
  /** Zoom actually used by the last `levelFor` call. */
  readonly stableZoom: number;
  /** True while the quantization window is open. */
  readonly quantized: boolean;
  dispose(): void;
}

export function createLodController(clock: EngineClock): LodController {
  let current: PaintLod | null = null;
  let stable = 0;
  let timer: number | null = null;

  const release = (): void => {
    timer = null;
  };

  const levelFor = (zoom: number): PaintLod => {
    stable = timer === null ? zoom : quantizeZoom(zoom);
    current = paintLodFor(stable, current);
    return current;
  };

  return {
    levelFor,
    level(zoom: number): LodLevel {
      return toLodLevel(levelFor(zoom));
    },
    cameraChanged(): void {
      if (timer !== null) clock.clearTimer(timer);
      timer = clock.setTimer(release, LOD_SETTLE_MS);
    },
    get stableZoom(): number {
      return stable;
    },
    get quantized(): boolean {
      return timer !== null;
    },
    dispose(): void {
      if (timer !== null) clock.clearTimer(timer);
      timer = null;
    },
  };
}
