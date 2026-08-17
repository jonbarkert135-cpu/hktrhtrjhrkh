import { describe, expect, it } from 'vitest';

import { reduce } from '../src/interaction/fsm';
import type { Effect, FsmState } from '../src/interaction/fsm';
import { DRAG_THRESHOLD_PX, GRID_SNAP } from '../src/constants';
import type { NodeView } from '../src/types';
import { at, context, intentsOf, mods, node, onNode, pointer, run } from './fsm.support';

const nodes = [node('a', 0, 0, 100, 60), node('b', 400, 400, 100, 60)];

const moveIntents = (effects: readonly Effect[]) =>
  intentsOf(effects).flatMap((i) => (i.t === 'move-nodes' ? [i] : []));

describe('node drag', () => {
  it('commits nothing before the 4 px threshold', () => {
    const res = run(
      [
        pointer('pointerdown', at(10, 10), onNode('a')),
        pointer('pointermove', at(10 + DRAG_THRESHOLD_PX, 10), onNode('a')),
      ],
      context(nodes, { selection: ['a'] }),
    );
    expect(res.state.name).toBe('pressPending');
    expect(res.all.filter((e) => e.t === 'intent')).toEqual([]);
    expect(res.all.some((e) => e.t === 'preview-move')).toBe(false);
  });

  it('crosses the threshold into draggingNodes and emits phase start with no deltas', () => {
    const res = run(
      [
        pointer('pointerdown', at(10, 10), onNode('a')),
        pointer('pointermove', at(20, 10), onNode('a')),
      ],
      context(nodes, { selection: ['a'] }),
    );
    expect(res.state.name).toBe('draggingNodes');
    expect(moveIntents(res.all)).toEqual([
      { t: 'move-nodes', deltas: [], phase: 'start' },
      { t: 'move-nodes', deltas: [], phase: 'update' },
    ]);
    expect(res.effects).toContainEqual({ t: 'preview-move', ids: ['a'], dx: 10, dy: 0 });
  });

  it('dragging an unselected node replaces the selection first', () => {
    const res = run(
      [
        pointer('pointerdown', at(410, 410), onNode('b')),
        pointer('pointermove', at(450, 410), onNode('b')),
      ],
      context(nodes, { selection: ['a'] }),
    );
    expect(intentsOf(res.all)[0]).toEqual({ t: 'select', ids: ['b'], mode: 'replace' });
    expect(res.state.name === 'draggingNodes' && res.state.ids).toEqual(['b']);
  });

  it('dragging a selected node moves the whole selection with one transform', () => {
    const res = run(
      [
        pointer('pointerdown', at(10, 10), onNode('a')),
        pointer('pointermove', at(60, 40), onNode('a')),
        pointer('pointerup', at(60, 40), onNode('a')),
      ],
      context(nodes, { selection: ['a', 'b'] }),
    );
    expect(moveIntents(res.all).at(-1)).toEqual({
      t: 'move-nodes',
      phase: 'end',
      deltas: [
        { id: 'a', dx: 50, dy: 30 },
        { id: 'b', dx: 50, dy: 30 },
      ],
    });
  });

  it('locked members of the selection are left behind', () => {
    const withLocked = [node('a', 0, 0), node('l', 200, 0, 100, 60, { locked: true })];
    const res = run(
      [
        pointer('pointerdown', at(10, 10), onNode('a')),
        pointer('pointermove', at(60, 10), onNode('a')),
      ],
      context(withLocked, { selection: ['a', 'l'] }),
    );
    expect(res.state.name === 'draggingNodes' && res.state.ids).toEqual(['a']);
  });

  it('dragging 200 selected nodes produces exactly one committed patch (acceptance 3)', () => {
    const many: NodeView[] = Array.from({ length: 200 }, (_, i) =>
      node(`n${i}`, (i % 20) * 150, Math.floor(i / 20) * 150, 100, 60),
    );
    const ctx = context(many, { selection: many.map((n) => n.id) });
    const script = [
      pointer('pointerdown', at(10, 10), onNode('n0')),
      ...Array.from({ length: 50 }, (_, i) =>
        pointer('pointermove', at(10 + (i + 1) * 6, 10), onNode('n0')),
      ),
      pointer('pointerup', at(310, 10), onNode('n0')),
    ];
    const res = run(script, ctx);
    const moves = moveIntents(res.all);
    const committed = moves.filter((m) => m.deltas.length > 0);
    expect(committed).toHaveLength(1);
    expect(committed[0]?.phase).toBe('end');
    expect(committed[0]?.deltas).toHaveLength(200);
    expect(committed[0]?.deltas[199]).toEqual({ id: 'n199', dx: 300, dy: 0 });
    expect(moves.filter((m) => m.phase === 'start')).toHaveLength(1);
    expect(res.all.filter((e) => e.t === 'preview-move')).toHaveLength(50);
  });

  it('Escape mid-drag restores every pre-drag position (acceptance 4)', () => {
    const ctx = context(nodes, { selection: ['a', 'b'] });
    const dragging = run(
      [
        pointer('pointerdown', at(10, 10), onNode('a')),
        pointer('pointermove', at(90, 70), onNode('a')),
      ],
      ctx,
    );
    const cancelled = reduce(
      dragging.state,
      { t: 'keydown', key: 'Escape', mods: mods({}), repeat: false },
      ctx,
    );
    expect(cancelled.state.name).toBe('idle');
    expect(cancelled.effects).toContainEqual({
      t: 'restore-geometry',
      positions: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 400, y: 400 },
      ],
    });
    expect(moveIntents(cancelled.effects)).toEqual([
      { t: 'move-nodes', deltas: [], phase: 'cancel' },
    ]);
    expect(cancelled.effects).toContainEqual({ t: 'preview-move', ids: ['a', 'b'], dx: 0, dy: 0 });
    expect(cancelled.effects).toContainEqual({ t: 'release', pointerId: 1 });
  });

  it('pointercancel and blur cancel identically to Escape', () => {
    const ctx = context(nodes, { selection: ['a'] });
    const dragging = run(
      [
        pointer('pointerdown', at(10, 10), onNode('a')),
        pointer('pointermove', at(90, 70), onNode('a')),
      ],
      ctx,
    );
    const escape = reduce(
      dragging.state,
      { t: 'keydown', key: 'Escape', mods: mods({}), repeat: false },
      ctx,
    );
    const cancel = reduce(dragging.state, { t: 'pointercancel', pointerId: 1 }, ctx);
    const blur = reduce(dragging.state, { t: 'blur' }, ctx);
    expect(cancel).toEqual(escape);
    expect(blur).toEqual(escape);
  });

  it('cancelling a resize restores the pre-gesture rect', () => {
    const ctx = context(nodes, { selection: ['a'] });
    const resizing = run(
      [
        pointer('pointerdown', at(100, 60), { t: 'handle', id: 'a', handle: 'se' }),
        pointer('pointermove', at(300, 300), { t: 'handle', id: 'a', handle: 'se' }),
      ],
      ctx,
    );
    const cancelled = reduce(resizing.state, { t: 'pointercancel', pointerId: 1 }, ctx);
    expect(cancelled.state.name).toBe('idle');
    expect(intentsOf(cancelled.effects)).toEqual([
      { t: 'resize-node', id: 'a', w: 100, h: 60, x: 0, y: 0, phase: 'cancel' },
    ]);
    expect(cancelled.effects).toContainEqual({
      t: 'restore-geometry',
      positions: [{ id: 'a', x: 0, y: 0 }],
    });
  });

  it('cancelling from a non-gesture state is a no-op that still lands in idle', () => {
    const ctx = context(nodes);
    for (const state of [
      { name: 'idle' },
      { name: 'hover', target: onNode('a') },
      { name: 'spacePan' },
      { name: 'editing', id: 'a' },
    ] satisfies FsmState[]) {
      const res = reduce(state, { t: 'pointercancel', pointerId: 1 }, ctx);
      expect(res.state).toEqual({ name: 'idle' });
      expect(res.effects).toEqual([]);
    }
    const press = run([pointer('pointerdown', at(10, 10), onNode('a'))], ctx);
    const cancelled = reduce(press.state, { t: 'pointercancel', pointerId: 1 }, ctx);
    expect(cancelled.state.name).toBe('idle');
    expect(intentsOf(cancelled.effects)).toEqual([]);
    const connecting = run(
      [
        pointer('pointerdown', at(100, 30), {
          t: 'port',
          id: 'a',
          anchor: { side: 'right', t: 0.5 },
        }),
      ],
      ctx,
    );
    expect(reduce(connecting.state, { t: 'pointercancel', pointerId: 1 }, ctx).state.name).toBe(
      'idle',
    );
  });

  it('a drag started while Space is latched returns to spacePan', () => {
    const ctx = context(nodes, { selection: ['a'] });
    const res = run(
      [
        { t: 'keydown', key: ' ', mods: mods({}), repeat: false },
        pointer('pointerdown', at(10, 10), onNode('a')),
        pointer('pointermove', at(80, 10), onNode('a')),
        pointer('pointerup', at(80, 10), onNode('a')),
      ],
      ctx,
    );
    // Space latch turns the press into a camera pan, never a node drag.
    expect(res.state.name).toBe('spacePan');
    expect(moveIntents(res.all)).toEqual([]);
    expect(res.all.some((e) => e.t === 'camera-pan')).toBe(true);
  });

  it('applies grid snapping during the drag and Ctrl suspends it', () => {
    const ctx = context(nodes, {
      selection: ['a'],
      features: { snapToGrid: true, alignmentGuides: false },
    });
    const snapped = run(
      [
        pointer('pointerdown', at(10, 10), onNode('a')),
        pointer('pointermove', at(31, 10), onNode('a')),
      ],
      ctx,
    );
    const preview = snapped.effects.find((e) => e.t === 'preview-move');
    expect(preview?.t === 'preview-move' && preview.dx % GRID_SNAP).toBe(0);
    expect(preview?.t === 'preview-move' && preview.dx).toBe(24);

    const free = run(
      [
        pointer('pointerdown', at(10, 10), onNode('a')),
        pointer('pointermove', at(31, 10), onNode('a'), { mods: mods({ ctrl: true }) }),
      ],
      ctx,
    );
    const rawPreview = free.effects.find((e) => e.t === 'preview-move');
    expect(rawPreview?.t === 'preview-move' && rawPreview.dx).toBe(21);
  });

  it('emits alignment guides while dragging and clears them on drop', () => {
    const scene = [node('a', 0, 0, 100, 60), node('b', 300, 0, 100, 60)];
    const ctx = context(scene, {
      selection: ['a'],
      features: { snapToGrid: false, alignmentGuides: true },
    });
    const res = run(
      [
        pointer('pointerdown', at(10, 10), onNode('a')),
        pointer('pointermove', at(13, 13), onNode('a')), // top edge 3 px below b's top: inside 6 px
        pointer('pointerup', at(13, 13), onNode('a')),
      ],
      ctx,
    );
    const guides = res.all.flatMap((e) => (e.t === 'guides' ? [e.guides] : []));
    expect(guides[0]?.some((g) => g.axis === 'y' && g.pos === 0)).toBe(true);
    expect(guides.at(-1)).toEqual([]);
    // The snap pulled the node back onto b's top edge, so dy commits as 0.
    expect(moveIntents(res.all).at(-1)?.deltas).toEqual([{ id: 'a', dx: 3, dy: 0 }]);
  });
});
