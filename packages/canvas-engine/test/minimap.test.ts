import { describe, expect, it } from 'vitest';

import { createMinimap } from '../src/minimap';
import { createRecordingTarget } from '../src/render/recording-target';
import { createManualClock } from '../src/testing';
import { gridScene, harness } from './engine.support';
import { theme } from './render-fixtures';

function setup(nodes = 25): ReturnType<typeof harness> & {
  minimap: ReturnType<typeof createMinimap>;
  mini: ReturnType<typeof createRecordingTarget>;
} {
  const h = harness(gridScene(nodes, 5));
  const mini = createRecordingTarget(200, 150, 1);
  const minimap = createMinimap({
    target: mini,
    clock: h.clock,
    query: h.engine.query,
    camera: h.engine.camera,
    theme,
  });
  return { ...h, mini, minimap };
}

describe('minimap', () => {
  it('paints the scene and the viewport rect', () => {
    const { minimap, mini } = setup();
    expect(minimap.tick()).toBe(true);

    expect(mini.frames).toBe(1);
    // 25 node rects + the viewport outline.
    expect(mini.ops('rect')).toHaveLength(26);
    expect(minimap.worldRect.w).toBeGreaterThan(0);
  });

  it('repaints at most 10 times per second, independently of the main loop (req 14)', () => {
    const { minimap, clock } = setup(4);
    expect(minimap.tick()).toBe(true);

    minimap.invalidate();
    clock.advance(50);
    expect(minimap.tick()).toBe(false); // inside the 100 ms budget

    clock.advance(60);
    expect(minimap.tick()).toBe(true);
  });

  it('does not repaint when nothing invalidated it', () => {
    const { minimap, clock } = setup(4);
    minimap.tick();
    clock.advance(1_000);
    expect(minimap.tick()).toBe(false);
  });

  it('click-to-jump centres the camera on the clicked world point (acceptance 6)', () => {
    const { minimap, engine, clock } = setup(25);
    minimap.tick();

    const before = engine.camera.viewportWorld;
    minimap.jumpTo({ x: 190, y: 140 }); // bottom-right of the minimap
    const after = engine.camera.viewportWorld;

    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);

    // The viewport rect tracks the camera: the next paint uses the moved viewport.
    minimap.invalidate();
    clock.advance(120);
    expect(minimap.tick()).toBe(true);
  });

  it('drag-to-pan keeps following the pointer and stops after dispose', () => {
    const { minimap, engine } = setup(25);
    minimap.tick();
    minimap.panTo({ x: 20, y: 20 });
    const moved = engine.camera.state.x;
    minimap.panTo({ x: 180, y: 130 });
    expect(engine.camera.state.x).toBeGreaterThan(moved);

    minimap.dispose();
    const parked = engine.camera.state.x;
    minimap.panTo({ x: 20, y: 20 });
    minimap.jumpTo({ x: 20, y: 20 });
    expect(engine.camera.state.x).toBe(parked);
    expect(minimap.tick()).toBe(false);
  });

  it('falls back to the viewport on an empty board', () => {
    const clock = createManualClock();
    const h = harness(gridScene(0));
    const mini = createRecordingTarget(120, 90, 1);
    const minimap = createMinimap({
      target: mini,
      clock,
      query: h.engine.query,
      camera: h.engine.camera,
      theme,
    });

    expect(minimap.tick()).toBe(true);
    expect(mini.ops('rect')).toHaveLength(1);
  });
});
