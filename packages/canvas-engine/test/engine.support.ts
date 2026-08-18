/** Shared fixtures for the engine-facade tests (owned by the orchestrator). */

import { createEngine, type Engine, type EngineOptions } from '../src/engine';
import { createOverlay, type Overlay, type OverlaySlot } from '../src/render/overlay';
import { createRecordingTarget, type RecordingTarget } from '../src/render/recording-target';
import { createManualClock, type ManualClock } from '../src/testing';
import type { NodeView, SceneSnapshot } from '../src/types';
import { makeNode, metrics, theme } from './render-fixtures';

export interface FakeSlot extends OverlaySlot {
  removed: boolean;
}

function fakeSlot(): FakeSlot {
  return {
    style: { transform: '', willChange: '', width: '', height: '' },
    removed: false,
    setAttribute(): void {
      // attributes are asserted in the overlay's own tests
    },
    removeAttribute(): void {
      // as above
    },
    remove(): void {
      this.removed = true;
    },
  };
}

export function fakeOverlay(): { overlay: Overlay<FakeSlot>; mounted: () => number } {
  const children: FakeSlot[] = [];
  const overlay = createOverlay<FakeSlot>({
    document: { createElement: (): FakeSlot => fakeSlot() },
    container: {
      style: { transform: '', willChange: '', width: '', height: '' },
      appendChild: (child: FakeSlot): void => {
        children.push(child);
      },
    },
  });
  return { overlay, mounted: (): number => children.filter((c) => !c.removed).length };
}

/** A grid of `count` nodes, 120×80 every 200 px, deterministic ids `n0…`. */
export function gridScene(count: number, perRow = 10): SceneSnapshot {
  const nodes: NodeView[] = [];
  for (let i = 0; i < count; i += 1) {
    nodes.push(
      makeNode(i, {
        id: `n${String(i)}`,
        x: (i % perRow) * 200,
        y: Math.floor(i / perRow) * 200,
        w: 120,
        h: 80,
        z: i,
        layerId: 'default',
      }),
    );
  }
  return {
    nodes,
    edges: [],
    groups: [],
    layers: [{ id: 'default', name: 'default', visible: true, locked: false }],
  };
}

export interface Harness {
  engine: Engine;
  clock: ManualClock;
  target: RecordingTarget;
  overlay: Overlay<FakeSlot>;
  mounted: () => number;
}

export function harness(
  scene: SceneSnapshot = gridScene(0),
  over: Partial<EngineOptions> = {},
  /** Headless mode drops the overlay entirely: the canvas then paints every tier itself. */
  headless = false,
): Harness {
  const clock = createManualClock(1000);
  const target = createRecordingTarget(800, 600, 1);
  const { overlay, mounted } = fakeOverlay();
  const engine = createEngine(
    headless
      ? { target, clock, theme, metrics, initialScene: scene, ...over }
      : { target, clock, theme, metrics, initialScene: scene, overlay, ...over },
  );
  return { engine, clock, target, overlay, mounted };
}
