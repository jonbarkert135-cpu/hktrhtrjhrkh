import { describe, expect, it } from 'vitest';

import { reduce } from '../src/interaction/fsm';
import { DRAG_THRESHOLD_PX } from '../src/constants';
import { at, context, intentsOf, mods, node, pointer, run } from './fsm.support';

// a fully inside the band, b straddling its right edge, c far away.
const nodes = [node('a', 10, 10, 50, 50), node('b', 190, 10, 50, 50), node('c', 900, 900, 50, 50)];
const band = { x: 0, y: 0 };

describe('marquee', () => {
  it('does not start before the drag threshold is crossed', () => {
    const ctx = context(nodes);
    const below = run(
      [
        pointer('pointerdown', at(band.x, band.y)),
        pointer('pointermove', at(DRAG_THRESHOLD_PX, 0)),
      ],
      ctx,
    );
    expect(below.state.name).toBe('pressPending');
    expect(below.all.filter((e) => e.t === 'marquee')).toEqual([]);

    const above = run(
      [
        pointer('pointerdown', at(band.x, band.y)),
        pointer('pointermove', at(DRAG_THRESHOLD_PX + 1, 0)),
      ],
      ctx,
    );
    expect(above.state.name).toBe('marquee');
    expect(above.effects).toContainEqual({ t: 'marquee', rect: { x: 0, y: 0, w: 5, h: 0 } });
  });

  it('selects by intersection by default', () => {
    const res = run(
      [
        pointer('pointerdown', at(0, 0)),
        pointer('pointermove', at(100, 100)),
        pointer('pointermove', at(200, 100)),
        pointer('pointerup', at(200, 100)),
      ],
      context(nodes),
    );
    expect(intentsOf(res.all)).toEqual([{ t: 'select', ids: ['a', 'b'], mode: 'replace' }]);
    expect(res.effects).toContainEqual({ t: 'marquee', rect: null });
    expect(res.state.name).toBe('idle');
  });

  it('alt switches to contain mode', () => {
    const alt = mods({ alt: true });
    const res = run(
      [
        pointer('pointerdown', at(0, 0), { t: 'canvas' }, { mods: alt }),
        pointer('pointermove', at(200, 100), { t: 'canvas' }, { mods: alt }),
        pointer('pointerup', at(200, 100), { t: 'canvas' }, { mods: alt }),
      ],
      context(nodes),
    );
    // 'b' straddles x=200 so it is intersected but not contained.
    expect(intentsOf(res.all)).toEqual([{ t: 'select', ids: ['a'], mode: 'replace' }]);
  });

  it('alt released mid-gesture reverts to intersect mode', () => {
    const alt = mods({ alt: true });
    const res = run(
      [
        pointer('pointerdown', at(0, 0)),
        pointer('pointermove', at(200, 100), { t: 'canvas' }, { mods: alt }),
        pointer('pointermove', at(200, 100)),
        pointer('pointerup', at(200, 100)),
      ],
      context(nodes),
    );
    expect(intentsOf(res.all)).toEqual([{ t: 'select', ids: ['a', 'b'], mode: 'replace' }]);
  });

  it('shift makes the marquee additive', () => {
    const shift = mods({ shift: true });
    const res = run(
      [
        pointer('pointerdown', at(0, 0), { t: 'canvas' }, { mods: shift }),
        pointer('pointermove', at(100, 100), { t: 'canvas' }, { mods: shift }),
        pointer('pointerup', at(100, 100), { t: 'canvas' }, { mods: shift }),
      ],
      context(nodes, { selection: ['c'] }),
    );
    expect(intentsOf(res.all)).toEqual([{ t: 'select', ids: ['a'], mode: 'add' }]);
  });

  it('tracks the rect while dragging in any direction', () => {
    const res = run(
      [pointer('pointerdown', at(100, 100)), pointer('pointermove', at(40, 60))],
      context(nodes),
    );
    expect(res.effects).toContainEqual({ t: 'marquee', rect: { x: 40, y: 60, w: 60, h: 40 } });
  });

  it('Escape and pointercancel both clear the rect and select nothing', () => {
    const ctx = context(nodes);
    const started = run(
      [pointer('pointerdown', at(0, 0)), pointer('pointermove', at(100, 100))],
      ctx,
    );
    for (const cancel of [
      reduce(started.state, { t: 'keydown', key: 'Escape', mods: mods({}), repeat: false }, ctx),
      reduce(started.state, { t: 'pointercancel', pointerId: 1 }, ctx),
      reduce(started.state, { t: 'blur' }, ctx),
    ]) {
      expect(cancel.state.name).toBe('idle');
      expect(cancel.effects).toContainEqual({ t: 'marquee', rect: null });
      expect(cancel.effects).toContainEqual({ t: 'release', pointerId: 1 });
      expect(intentsOf(cancel.effects)).toEqual([]);
    }
  });

  it('a drag started on a locked node degrades into a marquee', () => {
    const locked = [node('l', 0, 0, 50, 50, { locked: true }), node('a', 60, 0, 50, 50)];
    const res = run(
      [
        pointer('pointerdown', at(10, 10), { t: 'node', id: 'l' }),
        pointer('pointermove', at(100, 40), { t: 'node', id: 'l' }),
        pointer('pointerup', at(100, 40)),
      ],
      context(locked, { selection: [] }),
    );
    expect(intentsOf(res.all)).toEqual([{ t: 'select', ids: ['l', 'a'], mode: 'replace' }]);
    expect(res.all.some((e) => e.t === 'preview-move')).toBe(false);
  });

  it('a shift-drag on a locked node degrades into an additive marquee', () => {
    const locked = [node('l', 0, 0, 50, 50, { locked: true }), node('a', 60, 0, 50, 50)];
    const shift = mods({ shift: true });
    const res = run(
      [
        pointer('pointerdown', at(10, 10), { t: 'node', id: 'l' }, { mods: shift }),
        pointer('pointermove', at(100, 40), { t: 'node', id: 'l' }, { mods: shift }),
        pointer('pointerup', at(100, 40), { t: 'canvas' }, { mods: shift }),
      ],
      context(locked, { selection: ['l'] }),
    );
    expect(intentsOf(res.all)).toEqual([{ t: 'select', ids: ['l', 'a'], mode: 'add' }]);
  });
});
