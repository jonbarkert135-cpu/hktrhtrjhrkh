/**
 * `hostsChanged` (P4 §7). The host application renders its own cards into the overlay slots, so it
 * needs to know when the promoted set changes — and *only* when it changes, or a pan at DOM zoom
 * would re-render every card every frame.
 */

import { describe, expect, it } from 'vitest';

import { gridScene, harness } from './engine.support';

const CENTRE = { x: 400, y: 300 };

describe('createEngine — hostsChanged', () => {
  it('announces the promoted set once it reaches the DOM tier', () => {
    const { engine, clock } = harness(gridScene(6));
    const seen: string[][] = [];
    engine.on('hostsChanged', (ids) => seen.push([...ids]));

    engine.camera.zoomTo(0.3, CENTRE);
    clock.advance(200);
    engine.tick();
    expect(seen).toHaveLength(0); // glyph tier: the canvas paints, nothing is promoted

    engine.camera.zoomTo(1, CENTRE);
    clock.advance(200);
    engine.tick();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.length).toBeGreaterThan(0);
  });

  it('does not fire again while the promoted set is unchanged', () => {
    const { engine, clock } = harness(gridScene(4));
    let calls = 0;
    engine.on('hostsChanged', () => {
      calls += 1;
    });

    engine.camera.zoomTo(1, CENTRE);
    clock.advance(200);
    engine.tick();
    expect(calls).toBe(1);

    engine.tick();
    engine.tick();
    expect(calls).toBe(1);
  });

  it('empties the set when the camera leaves the DOM tier', () => {
    const { engine, clock } = harness(gridScene(4));
    const seen: string[][] = [];
    engine.on('hostsChanged', (ids) => seen.push([...ids]));

    engine.camera.zoomTo(1, CENTRE);
    clock.advance(200);
    engine.tick();

    engine.camera.zoomTo(0.2, CENTRE);
    clock.advance(200);
    engine.tick();

    expect(seen.at(-1)).toEqual([]);
  });
});
