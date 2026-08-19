import { describe, expect, it } from 'vitest';

import type { Intent } from '../src/types';
import { gridScene, harness } from './engine.support';
import { runPointerScript } from '../src/testing';

const CENTRE = { x: 400, y: 300 };

function centreOfView(engine: {
  camera: { viewportWorld: { x: number; y: number; w: number; h: number } };
}): {
  x: number;
  y: number;
} {
  const v = engine.camera.viewportWorld;
  return { x: v.x + v.w / 2, y: v.y + v.h / 2 };
}

describe('createEngine — frames', () => {
  it('paints one frame per tick and reports stats', () => {
    const { engine, target, clock } = harness(gridScene(12));
    engine.camera.zoomTo(0.45, CENTRE);
    const stats = engine.tick();

    // At the glyph tier the canvas paints the nodes itself; at the DOM tier the overlay owns them.
    expect(stats.paintedNodes).toBeGreaterThan(0);
    expect(stats.lod).toBe('glyph');
    expect(target.ops('clear')).toHaveLength(1);

    engine.camera.zoomTo(1, CENTRE);
    clock.advance(200); // let the gesture settle so the tier re-evaluates (05 §6.8)
    const domFrame = engine.tick();
    expect(domFrame.lod).toBe('dom');
    expect(domFrame.paintedNodes).toBe(0);
    expect(domFrame.mountedHosts).toBeGreaterThan(0);
  });

  it('coalesces any number of invalidations into a single scheduled frame', () => {
    const { engine, clock } = harness(gridScene(4));
    let frames = 0;
    engine.on('frame', () => {
      frames += 1;
    });

    for (let i = 0; i < 25; i += 1) engine.invalidate();
    expect(clock.pendingFrames).toBe(1);
    clock.flushFrame();

    expect(frames).toBe(1);
    expect(clock.pendingFrames).toBe(0);
  });

  it('pauses on a hidden tab and resumes with a single frame, without replaying', () => {
    const { engine, clock } = harness(gridScene(4));
    let frames = 0;
    engine.on('frame', () => {
      frames += 1;
    });

    engine.setPaused(true);
    engine.invalidate();
    engine.invalidate();
    expect(clock.pendingFrames).toBe(0);

    clock.advance(5_000);
    engine.setPaused(false);
    expect(clock.pendingFrames).toBe(1);
    clock.flushFrame();
    expect(frames).toBe(1);
  });

  it('resizes the backing store exactly once per viewport change', () => {
    const { engine, target } = harness(gridScene(1));
    engine.setViewport(1024, 768, 1.25);

    expect(target.size).toEqual({ width: 1024, height: 768 });
    expect(target.dpr).toBe(1.25);
    expect(engine.camera.viewportWorld.w).toBeCloseTo(1024 / engine.camera.state.zoom, 6);
  });
});

describe('createEngine — LOD and DOM promotion (acceptance 2)', () => {
  it('mounts no DOM hosts at zoom 0.3 and only visible ones at zoom 1.0', () => {
    const { engine, clock, mounted } = harness(gridScene(400, 20));

    engine.camera.zoomTo(0.3, CENTRE);
    engine.tick();
    expect(engine.state.lod).toBe('glyph');
    expect(mounted()).toBe(0);

    engine.camera.zoomTo(1, CENTRE);
    // The tier is frozen while the gesture is in flight (05 §6.8); it re-evaluates once it settles.
    clock.advance(200);
    engine.tick();
    expect(engine.state.lod).toBe('dom');
    const visible = mounted();
    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThan(400);
  });

  it('holds a quantized zoom while the camera is moving and releases it after the settle window', () => {
    const { engine, clock } = harness(gridScene(20));
    engine.camera.zoomTo(0.62, CENTRE);
    engine.tick();
    expect(engine.state.quantized).toBe(true);

    clock.advance(200);
    engine.tick();
    expect(engine.state.quantized).toBe(false);
  });
});

describe('createEngine — interaction', () => {
  it('marquee-selects 200 nodes and drags them with exactly one committed patch (acceptance 3)', () => {
    const { engine, clock } = harness(gridScene(200, 20));
    const intents: Intent[] = [];
    engine.on('intent', (intent) => {
      if (intent.t !== 'camera') intents.push(intent);
    });

    engine.camera.zoomTo(0.1, { x: 0, y: 0 });
    engine.camera.setState({ x: -100, y: -100, zoom: 0.1 }, 'user');
    intents.length = 0;

    // Marquee across the whole board, then drag the selection by 60 screen px.
    runPointerScript(engine, clock, [
      { t: 'down', at: { x: 1, y: 1 } },
      { t: 'move', at: { x: 700, y: 500 } },
      { t: 'up', at: { x: 700, y: 500 } },
    ]);
    expect(engine.selection.ids).toHaveLength(200);

    const first = engine.query.node('n0');
    // Well inside the card: the outer band is the connection port from P5 on (§5.3).
    const start = engine.camera.worldToScreen({ x: (first?.x ?? 0) + 60, y: (first?.y ?? 0) + 40 });
    intents.length = 0;
    runPointerScript(engine, clock, [
      { t: 'down', at: start },
      ...Array.from({ length: 50 }, (_unused, i) => ({
        t: 'move' as const,
        at: { x: start.x + 5 + i, y: start.y + 5 + i },
      })),
      { t: 'up', at: { x: start.x + 55, y: start.y + 55 } },
    ]);

    const commits = intents.filter((i) => i.t === 'move-nodes' && i.deltas.length > 0);
    expect(commits).toHaveLength(1);
    const commit = commits[0];
    expect(commit?.t === 'move-nodes' && commit.phase).toBe('end');
    expect(commit?.t === 'move-nodes' && commit.deltas).toHaveLength(200);
  });

  it('restores every pre-drag position when Escape cancels the drag (acceptance 4)', () => {
    const { engine, clock } = harness(gridScene(9, 3));
    const intents: Intent[] = [];
    engine.on('intent', (intent) => intents.push(intent));
    engine.camera.zoomTo(1, CENTRE);
    engine.camera.setState({ x: 0, y: 0, zoom: 1 }, 'user');

    runPointerScript(engine, clock, [
      { t: 'down', at: { x: 60, y: 40 } },
      { t: 'move', at: { x: 140, y: 90 } },
    ]);
    expect(engine.state.interaction).toBe('draggingNodes');

    engine.input.keyDown({
      key: 'Escape',
      mods: { shift: false, alt: false, ctrl: false, meta: false },
      repeat: false,
    });

    expect(engine.state.interaction).toBe('idle');
    expect(engine.query.node('n0')).toMatchObject({ x: 0, y: 0 });
    expect(intents.some((i) => i.t === 'move-nodes' && i.phase === 'cancel')).toBe(true);
    expect(intents.filter((i) => i.t === 'move-nodes' && i.phase === 'end')).toHaveLength(0);
  });

  it('emits hoverChanged only when the target under the pointer changes', () => {
    const { engine } = harness(gridScene(4, 2));
    engine.camera.setState({ x: 0, y: 0, zoom: 1 }, 'user');
    const seen: string[] = [];
    engine.on('hoverChanged', (target) => seen.push(target.t));

    engine.input.pointerMove({
      pointerId: 1,
      pointerType: 'mouse',
      button: -1,
      screen: { x: 60, y: 40 },
      mods: { shift: false, alt: false, ctrl: false, meta: false },
    });
    engine.input.pointerMove({
      pointerId: 1,
      pointerType: 'mouse',
      button: -1,
      screen: { x: 65, y: 45 },
      mods: { shift: false, alt: false, ctrl: false, meta: false },
    });
    engine.input.pointerMove({
      pointerId: 1,
      pointerType: 'mouse',
      button: -1,
      screen: { x: 700, y: 500 },
      mods: { shift: false, alt: false, ctrl: false, meta: false },
    });

    expect(seen).toEqual(['node', 'canvas']);
  });
});

describe('createEngine — camera helpers and events', () => {
  it('fits the selection and the requested nodes', () => {
    // Reduced motion makes every fit an instant jump, so the assertions read the final camera.
    const { engine } = harness(gridScene(9, 3), { prefersReducedMotion: true });
    engine.selection.set(['n0', 'n4']);
    engine.zoomToSelection();
    const selectionCentre = centreOfView(engine);
    // n0 (0,0,120,80) and n4 (200,200,120,80): the fitted view centres on their union.
    expect(selectionCentre.x).toBeCloseTo(160, 0);
    expect(selectionCentre.y).toBeCloseTo(140, 0);

    engine.fitToNodes(['n8'], 0);
    const nodeCentre = centreOfView(engine);
    expect(nodeCentre.x).toBeCloseTo(460, 0);
    expect(nodeCentre.y).toBeCloseTo(440, 0);

    // Unknown ids are a no-op, not a jump to the origin.
    engine.fitToNodes(['missing']);
    expect(centreOfView(engine)).toEqual(nodeCentre);
  });

  it('unsubscribes listeners returned by on()', () => {
    const { engine } = harness(gridScene(2));
    let count = 0;
    const off = engine.on('frame', () => {
      count += 1;
    });
    engine.tick();
    off();
    engine.tick();
    expect(count).toBe(1);
  });

  it('applies scene patches and repaints from them', () => {
    const { engine, clock } = harness(gridScene(2));
    engine.applyScenePatch({ op: 'remove-node', id: 'n1' });
    expect(engine.query.nodeCount).toBe(1);
    expect(clock.pendingFrames).toBe(1);
  });

  it('runs headless with no overlay: everything stays on canvas', () => {
    const { engine } = harness(gridScene(6), {}, true);
    engine.camera.zoomTo(1, CENTRE);
    const stats = engine.tick();
    expect(stats.mountedHosts).toBe(0);
    expect(stats.paintedNodes).toBeGreaterThan(0);
  });
});
