import { describe, expect, it } from 'vitest';

import { gridScene, harness } from './engine.support';

/**
 * Acceptance criterion 7 / requirement 17: after `dispose()` nothing is left running — no pending
 * frame, no pending timer, no mounted host, no live listener.
 */
describe('engine.dispose', () => {
  it('leaves zero pending frames, timers, hosts and listeners', () => {
    const { engine, clock, mounted, target } = harness(gridScene(40, 8));
    let frames = 0;
    engine.on('frame', () => {
      frames += 1;
    });

    engine.camera.zoomTo(0.9, { x: 400, y: 300 });
    engine.tick();
    expect(mounted()).toBeGreaterThan(0);
    expect(clock.pendingTimers).toBeGreaterThan(0); // the LOD settle timer is armed
    expect(clock.pendingFrames).toBeGreaterThan(0);

    engine.dispose();

    expect(clock.pendingFrames).toBe(0);
    expect(clock.pendingTimers).toBe(0);
    expect(mounted()).toBe(0);
    // The target is released too: painting after disposal would revive the whole pipeline.
    expect(target.frames).toBe(1);

    const before = frames;
    engine.invalidate();
    expect(clock.pendingFrames).toBe(0);
    engine.camera.panBy(50, 50);
    expect(frames).toBe(before);
  });

  it('is idempotent', () => {
    const { engine, clock } = harness(gridScene(4));
    engine.dispose();
    engine.dispose();
    expect(clock.pendingFrames).toBe(0);
  });

  it('drops input after disposal instead of throwing', () => {
    const { engine, clock } = harness(gridScene(4));
    engine.dispose();
    engine.input.pointerDown({
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      screen: { x: 10, y: 10 },
      mods: { shift: false, alt: false, ctrl: false, meta: false },
    });
    expect(clock.pendingFrames).toBe(0);
  });
});
