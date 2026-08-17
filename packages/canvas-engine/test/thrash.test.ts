import { describe, expect, it } from 'vitest';

import { LOD_THRESHOLDS } from '../src/constants';
import { gridScene, harness } from './engine.support';

/**
 * 20_ROADMAP P2 §8: a scripted 100-frame zoom across the DOM/glyph boundary must not thrash the
 * overlay — mount + unmount stays below 3× the visible node count. The stable ("efficient") zoom of
 * requirement 7 is what makes that possible.
 */
describe('LOD thrash', () => {
  it('keeps mount/unmount churn under 3× the visible nodes over 100 frames', () => {
    const { engine, clock, overlay } = harness(gridScene(120, 12));
    let mounts = 0;
    let unmounts = 0;
    const sync = overlay.sync.bind(overlay);
    // Count through the real diff the engine consumes; the overlay is otherwise untouched.
    overlay.sync = (candidates): ReturnType<typeof sync> => {
      const diff = sync(candidates);
      mounts += diff.mount.length;
      unmounts += diff.unmount.length;
      return diff;
    };

    engine.camera.setState({ x: 0, y: 0, zoom: 1 }, 'user');
    engine.tick();
    const visible = engine.state.mountedHosts;
    expect(visible).toBeGreaterThan(0);
    mounts = 0;
    unmounts = 0;

    // 100 frames oscillating around the DOM threshold (0.55), 8 ms apart: one continuous gesture.
    for (let i = 0; i < 100; i += 1) {
      const wobble = Math.sin(i / 4) * 0.06;
      engine.camera.zoomTo(LOD_THRESHOLDS.dom + wobble, { x: 400, y: 300 });
      clock.advance(8);
      engine.tick(clock.now());
    }

    expect(mounts + unmounts).toBeLessThan(visible * 3);
  });

  it('mounts nothing at all while the scene is below the DOM threshold', () => {
    const { engine, clock, mounted } = harness(gridScene(120, 12));
    engine.camera.setState({ x: 0, y: 0, zoom: 0.3 }, 'user');
    for (let i = 0; i < 20; i += 1) {
      engine.camera.panBy(12, 7);
      clock.advance(16);
      engine.tick(clock.now());
    }
    expect(mounted()).toBe(0);
  });
});
