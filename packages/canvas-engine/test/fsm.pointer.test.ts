import { describe, expect, it } from 'vitest';

import { cursorFor, createGestures } from '../src/interaction/gestures';
import type { RawPointer } from '../src/interaction/gestures';
import { reduce } from '../src/interaction/fsm';
import type { FsmEvent, FsmState } from '../src/interaction/fsm';
import { DBLCLICK_MAX_MS, LONG_PRESS_MS } from '../src/constants';
import type { EngineClock, HitTarget, Vec2 } from '../src/types';
import { at, context, intentsOf, mods, node, onNode, pointer, run } from './fsm.support';

const nodes = [
  node('a', 0, 0),
  node('b', 300, 0),
  node('locked', 600, 0, 100, 60, { locked: true }),
];

describe('pointer transitions', () => {
  it('enters hover on a hittable target and leaves it over empty canvas', () => {
    const ctx = context(nodes);
    const hovered = reduce({ name: 'idle' }, pointer('pointermove', at(10, 10), onNode('a')), ctx);
    expect(hovered.state).toEqual({ name: 'hover', target: { t: 'node', id: 'a' } });
    const left = reduce(hovered.state, pointer('pointermove', at(999, 999)), ctx);
    expect(left.state.name).toBe('idle');
  });

  it('pointerleave returns hover to idle but leaves a gesture alone', () => {
    const ctx = context(nodes);
    const hover: FsmState = { name: 'hover', target: onNode('a') };
    expect(reduce(hover, { t: 'pointerleave' }, ctx).state.name).toBe('idle');
    const drag = run(
      [
        pointer('pointerdown', at(10, 10), onNode('a')),
        pointer('pointermove', at(60, 10), onNode('a')),
      ],
      context(nodes, { selection: ['a'] }),
    );
    expect(reduce(drag.state, { t: 'pointerleave' }, ctx).state.name).toBe('draggingNodes');
  });

  it('press on a node parks in pressPending and captures the pointer', () => {
    const ctx = context(nodes);
    const res = reduce({ name: 'idle' }, pointer('pointerdown', at(10, 10), onNode('a')), ctx);
    expect(res.state.name).toBe('pressPending');
    expect(res.effects).toContainEqual({ t: 'capture', pointerId: 1 });
    expect(intentsOf(res.effects)).toEqual([]);
  });

  it('click selects, shift-click toggles, alt-click subtracts', () => {
    const ctx = context(nodes, { selection: ['a'] });
    const plain = run(
      [
        pointer('pointerdown', at(10, 10), onNode('b')),
        pointer('pointerup', at(10, 10), onNode('b')),
      ],
      ctx,
    );
    expect(intentsOf(plain.all)).toEqual([{ t: 'select', ids: ['b'], mode: 'replace' }]);
    expect(plain.state).toEqual({ name: 'hover', target: { t: 'node', id: 'b' } });

    const shift = run(
      [
        pointer('pointerdown', at(10, 10), onNode('b'), { mods: mods({ shift: true }) }),
        pointer('pointerup', at(10, 10), onNode('b'), { mods: mods({ shift: true }) }),
      ],
      ctx,
    );
    expect(intentsOf(shift.all)).toEqual([{ t: 'select', ids: ['b'], mode: 'toggle' }]);

    const alt = run(
      [
        pointer('pointerdown', at(10, 10), onNode('a'), { mods: mods({ alt: true }) }),
        pointer('pointerup', at(10, 10), onNode('a'), { mods: mods({ alt: true }) }),
      ],
      ctx,
    );
    expect(intentsOf(alt.all)).toEqual([{ t: 'select', ids: ['a'], mode: 'subtract' }]);
  });

  it('click on empty canvas clears, shift-click on empty canvas keeps the selection', () => {
    const ctx = context(nodes, { selection: ['a'] });
    const clear = run(
      [pointer('pointerdown', at(900, 900)), pointer('pointerup', at(900, 900))],
      ctx,
    );
    expect(intentsOf(clear.all)).toEqual([{ t: 'select', ids: [], mode: 'replace' }]);
    const keep = run(
      [
        pointer('pointerdown', at(900, 900), { t: 'canvas' }, { mods: mods({ shift: true }) }),
        pointer('pointerup', at(900, 900), { t: 'canvas' }, { mods: mods({ shift: true }) }),
      ],
      ctx,
    );
    expect(intentsOf(keep.all)).toEqual([]);
  });

  it('middle button pans and returns to idle on release', () => {
    const ctx = context(nodes);
    const res = run(
      [
        pointer('pointerdown', at(10, 10), { t: 'canvas' }, { button: 1 }),
        pointer('pointermove', at(40, 30)),
        pointer('pointerup', at(40, 30)),
      ],
      ctx,
    );
    expect(res.all).toContainEqual({ t: 'camera-pan', dxScreen: 30, dyScreen: 20 });
    expect(res.state.name).toBe('idle');
  });

  it('space latches pan and a press while latched pans back to spacePan on release', () => {
    const ctx = context(nodes);
    const res = run(
      [
        { t: 'keydown', key: ' ', mods: mods({}), repeat: false },
        pointer('pointerdown', at(10, 10)),
        pointer('pointermove', at(20, 10)),
        pointer('pointerup', at(20, 10)),
      ],
      ctx,
    );
    expect(res.state.name).toBe('spacePan');
    expect(reduce(res.state, { t: 'keyup', key: ' ', mods: mods({}) }, ctx).state.name).toBe(
      'idle',
    );
  });

  it('a non-primary button other than middle is ignored', () => {
    const ctx = context(nodes);
    const res = reduce(
      { name: 'idle' },
      pointer('pointerdown', at(1, 1), { t: 'canvas' }, { button: 2 }),
      ctx,
    );
    expect(res.state.name).toBe('idle');
    expect(res.effects).toEqual([]);
  });

  it('resize handle drags the node rect and commits on release', () => {
    const ctx = context(nodes, { selection: ['a'] });
    const handle: HitTarget = { t: 'handle', id: 'a', handle: 'se' };
    const res = run(
      [
        pointer('pointerdown', at(100, 60), handle),
        pointer('pointermove', at(150, 100), handle),
        pointer('pointerup', at(150, 100), handle),
      ],
      ctx,
    );
    expect(intentsOf(res.all)).toEqual([
      { t: 'resize-node', id: 'a', w: 150, h: 100, x: 0, y: 0, phase: 'update' },
      { t: 'resize-node', id: 'a', w: 150, h: 100, x: 0, y: 0, phase: 'end' },
    ]);
  });

  it('resize from a north-west handle moves the origin and clamps to the minimum size', () => {
    const ctx = context(nodes, { selection: ['a'] });
    const handle: HitTarget = { t: 'handle', id: 'a', handle: 'nw' };
    const res = run(
      [pointer('pointerdown', at(0, 0), handle), pointer('pointermove', at(500, 500), handle)],
      ctx,
    );
    const [update] = intentsOf(res.effects);
    expect(update).toEqual({
      t: 'resize-node',
      id: 'a',
      w: 24,
      h: 24,
      x: 76,
      y: 36,
      phase: 'update',
    });
  });

  it('resize is refused for locked nodes and for multi-selections', () => {
    const handle: HitTarget = { t: 'handle', id: 'locked', handle: 'se' };
    const locked = reduce(
      { name: 'idle' },
      pointer('pointerdown', at(600, 60), handle),
      context(nodes, { selection: ['locked'] }),
    );
    expect(locked.state.name).toBe('pressPending');
    const multi = reduce(
      { name: 'idle' },
      pointer('pointerdown', at(100, 60), { t: 'handle', id: 'a', handle: 'se' }),
      context(nodes, { selection: ['a', 'b'] }),
    );
    expect(multi.state.name).toBe('pressPending');
  });

  it('port drag creates an edge, and is discarded over empty canvas', () => {
    const ctx = context(nodes);
    const port: HitTarget = { t: 'port', id: 'a', anchor: { side: 'right', t: 0.5 } };
    const made = run(
      [
        pointer('pointerdown', at(100, 30), port),
        pointer('pointermove', at(200, 30)),
        pointer('pointerup', at(300, 30), onNode('b')),
      ],
      ctx,
    );
    expect(intentsOf(made.all)).toEqual([
      {
        t: 'create-edge',
        from: 'a',
        fromAnchor: { side: 'right', t: 0.5 },
        to: 'b',
        toAnchor: { side: 'auto', t: 0.5 },
      },
    ]);

    const dropped = run(
      [pointer('pointerdown', at(100, 30), port), pointer('pointerup', at(900, 900))],
      ctx,
    );
    expect(intentsOf(dropped.all)).toEqual([]);
    expect(dropped.state.name).toBe('idle');
  });

  it('port-to-port drop keeps the target anchor', () => {
    const ctx = context(nodes);
    const from: HitTarget = { t: 'port', id: 'a', anchor: { side: 'right', t: 0.5 } };
    const to: HitTarget = { t: 'port', id: 'b', anchor: { side: 'left', t: 0.25 } };
    const res = run(
      [pointer('pointerdown', at(100, 30), from), pointer('pointerup', at(300, 30), to)],
      ctx,
    );
    expect(intentsOf(res.all)).toEqual([
      {
        t: 'create-edge',
        from: 'a',
        fromAnchor: { side: 'right', t: 0.5 },
        to: 'b',
        toAnchor: { side: 'left', t: 0.25 },
      },
    ]);
  });

  it('double-click enters editing, and editing shields the canvas from input', () => {
    const ctx = context(nodes);
    const edit = reduce(
      { name: 'idle' },
      { t: 'dblclick', world: at(10, 10), target: onNode('a') },
      ctx,
    );
    expect(edit.state).toEqual({ name: 'editing', id: 'a' });
    expect(intentsOf(edit.effects)).toEqual([{ t: 'begin-edit-text', id: 'a' }]);
    expect(edit.effects).toContainEqual({ t: 'focus-editor', id: 'a' });

    const wheel = reduce(
      edit.state,
      { t: 'wheel', mode: 'zoom', deltaX: 0, deltaY: -100, anchorScreen: at(0, 0) },
      ctx,
    );
    expect(wheel.effects).toEqual([]);
    const pinched = reduce(
      edit.state,
      { t: 'pinch', factor: 1.2, anchorScreen: at(0, 0), panScreen: at(0, 0) },
      ctx,
    );
    expect(pinched.effects).toEqual([]);
    const away = reduce(edit.state, pointer('pointerdown', at(900, 900)), ctx);
    expect(away.state.name).toBe('idle');
    expect(reduce(edit.state, { t: 'edit-end', commit: true }, ctx).state.name).toBe('idle');
    expect(reduce({ name: 'idle' }, { t: 'edit-end', commit: true }, ctx).state.name).toBe('idle');
  });

  it('double-click on a locked node or empty canvas does not edit', () => {
    const ctx = context(nodes);
    expect(
      reduce({ name: 'idle' }, { t: 'dblclick', world: at(600, 10), target: onNode('locked') }, ctx)
        .state.name,
    ).toBe('idle');
    expect(
      reduce({ name: 'idle' }, { t: 'dblclick', world: at(9, 9), target: { t: 'canvas' } }, ctx)
        .state.name,
    ).toBe('idle');
  });

  it('context menu selects an unselected target but never disturbs an existing selection', () => {
    const fresh = reduce(
      { name: 'idle' },
      { t: 'contextmenu', world: at(10, 10), target: onNode('a') },
      context(nodes),
    );
    expect(intentsOf(fresh.effects)).toEqual([
      { t: 'select', ids: ['a'], mode: 'replace' },
      { t: 'context-menu', at: { x: 10, y: 10 }, target: { t: 'node', id: 'a' } },
    ]);
    const kept = reduce(
      { name: 'idle' },
      { t: 'longpress', world: at(10, 10), target: onNode('a') },
      context(nodes, { selection: ['a', 'b'] }),
    );
    expect(intentsOf(kept.effects)).toEqual([
      { t: 'context-menu', at: { x: 10, y: 10 }, target: { t: 'node', id: 'a' } },
    ]);
  });

  it('cancelling a pan returns to the state the pan started from', () => {
    const ctx = context(nodes);
    const panning = run(
      [
        pointer('pointerdown', at(10, 10), { t: 'canvas' }, { button: 1 }),
        pointer('pointermove', at(20, 20)),
      ],
      ctx,
    );
    const cancelled = reduce(panning.state, { t: 'pointercancel', pointerId: 1 }, ctx);
    expect(cancelled.state.name).toBe('idle');
    expect(cancelled.effects).toEqual([{ t: 'release', pointerId: 1 }]);

    const spacePanning = run(
      [
        { t: 'keydown', key: ' ', mods: mods({}), repeat: false },
        pointer('pointerdown', at(10, 10)),
      ],
      ctx,
    );
    expect(reduce(spacePanning.state, { t: 'blur' }, ctx).state.name).toBe('spacePan');
  });

  it('moves and stray ups in non-gesture states are inert', () => {
    const ctx = context(nodes);
    for (const state of [{ name: 'spacePan' }, { name: 'editing', id: 'a' }] satisfies FsmState[]) {
      const moved = reduce(state, pointer('pointermove', at(50, 50)), ctx);
      expect(moved.state).toBe(state);
      expect(moved.effects).toEqual([]);
    }
    expect(reduce({ name: 'idle' }, pointer('pointerup', at(1, 1)), ctx).effects).toEqual([]);
    expect(reduce({ name: 'spacePan' }, pointer('pointerup', at(1, 1)), ctx).effects).toEqual([]);
    expect(
      reduce({ name: 'editing', id: 'a' }, pointer('pointerup', at(1, 1)), ctx).effects,
    ).toEqual([{ t: 'release', pointerId: 1 }]);
  });

  it('wheel distinguishes zoom from pan and pinch drives both', () => {
    const ctx = context(nodes);
    const zoom = reduce(
      { name: 'idle' },
      { t: 'wheel', mode: 'zoom', deltaX: 0, deltaY: -120, anchorScreen: at(5, 6) },
      ctx,
    );
    expect(zoom.effects).toEqual([{ t: 'camera-zoom', steps: 120, anchorScreen: { x: 5, y: 6 } }]);
    const pan = reduce(
      { name: 'idle' },
      { t: 'wheel', mode: 'pan', deltaX: 10, deltaY: 20, anchorScreen: at(0, 0) },
      ctx,
    );
    expect(pan.effects).toEqual([{ t: 'camera-pan', dxScreen: -10, dyScreen: -20 }]);
    const pinch = reduce(
      { name: 'idle' },
      { t: 'pinch', factor: 1.5, anchorScreen: at(2, 2), panScreen: at(3, 4) },
      ctx,
    );
    expect(pinch.effects).toEqual([
      { t: 'camera-pan', dxScreen: 3, dyScreen: 4 },
      { t: 'camera-zoom-factor', factor: 1.5, anchorScreen: { x: 2, y: 2 } },
    ]);
  });
});

/* ------------------------------------------------------------------ gestures */

function manualClock(): EngineClock & { advance(ms: number): void } {
  let t = 0;
  const timers = new Map<number, { at: number; cb: () => void }>();
  let next = 1;
  return {
    now: () => t,
    requestFrame: () => 0,
    cancelFrame: () => undefined,
    setTimer(cb, ms) {
      const handle = next++;
      timers.set(handle, { at: t + ms, cb });
      return handle;
    },
    clearTimer(handle) {
      timers.delete(handle);
    },
    advance(ms) {
      t += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= t) {
          timers.delete(handle);
          timer.cb();
        }
      }
    },
  };
}

function harness(hit: (p: Vec2) => HitTarget = () => ({ t: 'canvas' })) {
  const clock = manualClock();
  const events: FsmEvent[] = [];
  const gestures = createGestures({
    clock,
    screenToWorld: (p) => p,
    hitTest: hit,
    emit: (e) => events.push(e),
  });
  return { clock, events, gestures };
}

const raw = (
  pointerId: number,
  x: number,
  y: number,
  over: Partial<RawPointer> = {},
): RawPointer => ({
  pointerId,
  pointerType: 'mouse',
  button: 0,
  screen: { x, y },
  mods: mods({}),
  ...over,
});

describe('gesture normalization', () => {
  it('turns raw pointers into world-resolved FSM events', () => {
    const { events, gestures } = harness(() => onNode('a'));
    gestures.pointerDown(raw(1, 10, 12));
    gestures.pointerMove(raw(1, 30, 12));
    gestures.pointerUp(raw(1, 30, 12));
    expect(events.map((e) => e.t)).toEqual(['pointerdown', 'pointermove', 'pointerup']);
    const [down] = events;
    expect(down?.t === 'pointerdown' && down.target).toEqual({ t: 'node', id: 'a' });
  });

  it('detects a double click inside DBLCLICK_MAX_MS and not outside it', () => {
    const { clock, events, gestures } = harness();
    gestures.pointerDown(raw(1, 10, 10));
    gestures.pointerUp(raw(1, 10, 10));
    clock.advance(DBLCLICK_MAX_MS - 10);
    gestures.pointerDown(raw(1, 11, 10));
    expect(events.some((e) => e.t === 'dblclick')).toBe(true);

    const slow = harness();
    slow.gestures.pointerDown(raw(1, 10, 10));
    slow.gestures.pointerUp(raw(1, 10, 10));
    slow.clock.advance(DBLCLICK_MAX_MS + 1);
    slow.gestures.pointerDown(raw(1, 10, 10));
    expect(slow.events.some((e) => e.t === 'dblclick')).toBe(false);

    const far = harness();
    far.gestures.pointerDown(raw(1, 10, 10));
    far.gestures.pointerUp(raw(1, 10, 10));
    far.clock.advance(10);
    far.gestures.pointerDown(raw(1, 60, 10));
    expect(far.events.some((e) => e.t === 'dblclick')).toBe(false);
  });

  it('fires a long press after LONG_PRESS_MS unless the pointer moved or lifted', () => {
    const held = harness();
    held.gestures.pointerDown(raw(1, 10, 10, { pointerType: 'touch' }));
    held.clock.advance(LONG_PRESS_MS);
    expect(held.events.some((e) => e.t === 'longpress')).toBe(true);

    const moved = harness();
    moved.gestures.pointerDown(raw(1, 10, 10, { pointerType: 'touch' }));
    moved.gestures.pointerMove(raw(1, 40, 10, { pointerType: 'touch' }));
    moved.clock.advance(LONG_PRESS_MS);
    expect(moved.events.some((e) => e.t === 'longpress')).toBe(false);

    const lifted = harness();
    lifted.gestures.pointerDown(raw(1, 10, 10, { pointerType: 'touch' }));
    lifted.gestures.pointerUp(raw(1, 10, 10, { pointerType: 'touch' }));
    lifted.clock.advance(LONG_PRESS_MS);
    expect(lifted.events.some((e) => e.t === 'longpress')).toBe(false);
  });

  it('a second finger cancels the single-touch gesture and starts pan/pinch', () => {
    const { events, gestures } = harness();
    gestures.pointerDown(raw(1, 100, 100, { pointerType: 'touch' }));
    gestures.pointerDown(raw(2, 200, 100, { pointerType: 'touch' }));
    expect(events.filter((e) => e.t === 'pointercancel')).toHaveLength(2);

    events.length = 0;
    gestures.pointerMove(raw(1, 90, 110, { pointerType: 'touch' }));
    gestures.pointerMove(raw(2, 210, 110, { pointerType: 'touch' }));
    const pinches = events.flatMap((e) => (e.t === 'pinch' ? [e] : []));
    expect(pinches).toHaveLength(2);
    expect(pinches[1]?.factor).toBeGreaterThan(1);
    expect(pinches[1]?.panScreen.y).toBeCloseTo(5, 6);
    expect(events.some((e) => e.t === 'pointermove')).toBe(false);

    events.length = 0;
    gestures.pointerUp(raw(2, 210, 110, { pointerType: 'touch' }));
    gestures.pointerUp(raw(1, 90, 110, { pointerType: 'touch' }));
    expect(events).toEqual([]);
  });

  it('ignores a window leave while a pointer is down, reports it when idle', () => {
    const { events, gestures } = harness();
    gestures.pointerDown(raw(1, 10, 10));
    events.length = 0;
    gestures.windowLeave();
    gestures.windowEnter();
    expect(events).toEqual([]);
    gestures.pointerUp(raw(1, 10, 10));
    events.length = 0;
    gestures.windowLeave();
    expect(events).toEqual([{ t: 'pointerleave' }]);
  });

  it('classifies wheel input: ctrl/meta zooms, shift swaps the pan axes', () => {
    const { events, gestures } = harness();
    gestures.wheel({
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      screen: at(4, 4),
    });
    gestures.wheel({
      deltaX: 0,
      deltaY: 40,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      screen: at(0, 0),
    });
    gestures.wheel({
      deltaX: 5,
      deltaY: 6,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      screen: at(0, 0),
    });
    expect(events).toEqual([
      { t: 'wheel', mode: 'zoom', deltaX: 0, deltaY: -100, anchorScreen: { x: 4, y: 4 } },
      { t: 'wheel', mode: 'pan', deltaX: 40, deltaY: 0, anchorScreen: { x: 0, y: 0 } },
      { t: 'wheel', mode: 'pan', deltaX: 5, deltaY: 6, anchorScreen: { x: 0, y: 0 } },
    ]);
  });

  it('forwards keys, cancel and blur, and clears its timers on dispose', () => {
    const { clock, events, gestures } = harness();
    gestures.keyDown({ key: 'a', mods: mods({ ctrl: true }), repeat: false });
    gestures.keyUp({ key: 'a', mods: mods({}), repeat: false });
    gestures.pointerDown(raw(1, 1, 1, { pointerType: 'touch' }));
    gestures.pointerCancel(1);
    gestures.pointerDown(raw(2, 1, 1, { pointerType: 'touch' }));
    gestures.blur();
    gestures.dispose();
    clock.advance(LONG_PRESS_MS * 2);
    expect(events.map((e) => e.t)).toEqual([
      'keydown',
      'keyup',
      'pointerdown',
      'pointercancel',
      'pointerdown',
      'blur',
    ]);
  });
});

describe('cursorFor', () => {
  it('resolves the roadmap §6 table', () => {
    const canvas: HitTarget = { t: 'canvas' };
    expect(cursorFor({ name: 'idle' }, canvas)).toBe('default');
    expect(cursorFor({ name: 'hover', target: onNode('a') }, onNode('a'))).toBe('default');
    expect(cursorFor({ name: 'idle' }, { t: 'edge', id: 'e1' })).toBe('default');
    expect(cursorFor({ name: 'spacePan' }, canvas)).toBe('grab');
    expect(
      cursorFor({ name: 'panning', pointerId: 1, screen: at(0, 0), fromSpace: true }, canvas),
    ).toBe('grabbing');
    expect(
      cursorFor(
        {
          name: 'marquee',
          pointerId: 1,
          origin: at(0, 0),
          current: at(1, 1),
          mode: 'replace',
          contain: false,
        },
        canvas,
      ),
    ).toBe('crosshair');
    expect(cursorFor({ name: 'editing', id: 'a' }, canvas)).toBe('text');
    expect(cursorFor({ name: 'idle' }, { t: 'handle', id: 'a', handle: 'nw' })).toBe('nw-resize');
    expect(
      cursorFor({ name: 'idle' }, { t: 'port', id: 'a', anchor: { side: 'auto', t: 0.5 } }),
    ).toBe('crosshair');
    expect(
      cursorFor(
        {
          name: 'resizing',
          pointerId: 1,
          id: 'a',
          handle: 'se',
          origin: at(0, 0),
          start: { x: 0, y: 0, w: 1, h: 1 },
          current: { x: 0, y: 0, w: 1, h: 1 },
        },
        canvas,
      ),
    ).toBe('se-resize');
    expect(
      cursorFor(
        {
          name: 'connecting',
          pointerId: 1,
          from: 'a',
          fromAnchor: { side: 'auto', t: 0.5 },
          current: at(0, 0),
        },
        canvas,
      ),
    ).toBe('crosshair');
    expect(
      cursorFor(
        {
          name: 'pressPending',
          pointerId: 1,
          screen: at(0, 0),
          world: at(0, 0),
          target: onNode('a'),
          mode: 'replace',
          time: 0,
          fromSpace: false,
        },
        canvas,
      ),
    ).toBe('grabbing');
    expect(
      cursorFor(
        {
          name: 'pressPending',
          pointerId: 1,
          screen: at(0, 0),
          world: at(0, 0),
          target: canvas,
          mode: 'replace',
          time: 0,
          fromSpace: false,
        },
        canvas,
      ),
    ).toBe('crosshair');
    expect(
      cursorFor(
        {
          name: 'draggingNodes',
          pointerId: 1,
          origin: at(0, 0),
          ids: ['a'],
          snapshot: [],
          box: { x: 0, y: 0, w: 1, h: 1 },
          delta: at(0, 0),
          fromSpace: false,
        },
        canvas,
      ),
    ).toBe('grabbing');
  });
});
