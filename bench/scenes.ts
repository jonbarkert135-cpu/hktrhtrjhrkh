// Deterministic benchmark scenes (18_TESTING.md §9.1). One seed per scene, so a regression is a
// real regression and not a different board.
import { makeBoard } from '@nexus/domain/test/factories';
import type { SceneSnapshot } from '@nexus/canvas-engine';

export interface BenchScene {
  name: string;
  scene: SceneSnapshot;
}

/** The N1 scene: 5,000 nodes / 10,000 edges. */
export function scene5000(): SceneSnapshot {
  return makeBoard({ nodes: 5000, edges: 10000, seed: 20260817 });
}

/** A small board for smoke runs and for measuring fixed per-frame overhead. */
export function scene100(): SceneSnapshot {
  return makeBoard({ nodes: 100, edges: 120, seed: 7 });
}

export const SCENES: readonly BenchScene[] = [
  { name: 'scene-100', scene: scene100() },
  { name: 'scene-5000', scene: scene5000() },
];
