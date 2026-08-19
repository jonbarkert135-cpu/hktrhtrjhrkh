/**
 * Edge creation through the FSM (20_ROADMAP P5 §5.3, §6): pointer drags from a port, drops on a
 * node, on another port, on empty canvas, and the keyboard route (C / Tab / Enter).
 */

import { describe, expect, it } from 'vitest';

import { reduce, type FsmState } from '../src/interaction/fsm';
import type { AnchorSpec, HitTarget } from '../src/types';
import { at, context, intentsOf, mods, node, onNode, pointer, run } from './fsm.support';

const nodes = [node('a', 0, 0), node('b', 300, 0), node('c', 0, 300)];

const anchor: AnchorSpec = { side: 'right', t: 0.5 };
const onPort = (id: string, side: AnchorSpec['side'] = 'right'): HitTarget => ({
  t: 'port',
  id,
  anchor: { side, t: 0.5 },
});

const key = (k: string, over: { shift?: boolean } = {}) =>
  ({ t: 'keydown', key: k, mods: mods({ shift: over.shift ?? false }), repeat: false }) as const;

describe('connection gestures', () => {
  it('a press on a port starts connecting and captures the pointer', () => {
    const res = reduce(
      { name: 'idle' },
      pointer('pointerdown', at(100, 30), onPort('a')),
      context(nodes),
    );
    expect(res.state).toMatchObject({ name: 'connecting', from: 'a', via: 'pointer' });
    expect(res.effects).toContainEqual({ t: 'capture', pointerId: 1 });
    expect(intentsOf(res.effects)).toEqual([]);
  });

  it('dropping on another node creates one edge with an auto target anchor', () => {
    const res = run(
      [
        pointer('pointerdown', at(100, 30), onPort('a')),
        pointer('pointermove', at(200, 30)),
        pointer('pointerup', at(310, 30), onNode('b')),
      ],
      context(nodes),
    );
    expect(intentsOf(res.all)).toEqual([
      {
        t: 'create-edge',
        from: 'a',
        fromAnchor: anchor,
        to: 'b',
        toAnchor: { side: 'auto', t: 0.5 },
      },
    ]);
    expect(res.state.name).toBe('idle');
  });

  it('dropping on a port keeps the side the analyst aimed at', () => {
    const res = run(
      [
        pointer('pointerdown', at(100, 30), onPort('a')),
        pointer('pointerup', at(300, 30), onPort('b', 'left')),
      ],
      context(nodes),
    );
    expect(intentsOf(res.all)).toEqual([
      {
        t: 'create-edge',
        from: 'a',
        fromAnchor: anchor,
        to: 'b',
        toAnchor: { side: 'left', t: 0.5 },
      },
    ]);
  });

  it('dropping on empty canvas asks the host for a node instead of cancelling', () => {
    const res = run(
      [pointer('pointerdown', at(100, 30), onPort('a')), pointer('pointerup', at(700, 500))],
      context(nodes),
    );
    expect(intentsOf(res.all)).toEqual([
      { t: 'connect-to-empty', from: 'a', fromAnchor: anchor, at: { x: 700, y: 500 } },
    ]);
  });

  it('dropping on the source node creates nothing', () => {
    const res = run(
      [
        pointer('pointerdown', at(100, 30), onPort('a')),
        pointer('pointerup', at(50, 30), onNode('a')),
      ],
      context(nodes),
    );
    expect(intentsOf(res.all)).toEqual([]);
  });

  it('Escape and pointercancel abort the gesture without writing anything', () => {
    const started = reduce(
      { name: 'idle' },
      pointer('pointerdown', at(100, 30), onPort('a')),
      context(nodes),
    );
    for (const event of [key('Escape'), { t: 'pointercancel', pointerId: 1 } as const]) {
      const aborted = reduce(started.state, event, context(nodes));
      expect(aborted.state.name).toBe('idle');
      expect(intentsOf(aborted.effects)).toEqual([]);
    }
  });
});

describe('keyboard connection (N6)', () => {
  const ctx = context(nodes, { selection: ['a'] });

  it('C aims at the nearest candidate and Tab cycles by proximity', () => {
    const started = reduce({ name: 'idle' }, key('c'), ctx);
    expect(started.state).toMatchObject({ name: 'connecting', from: 'a', via: 'keyboard' });
    const first = started.state as Extract<FsmState, { name: 'connecting' }>;
    expect(first.candidates).toEqual(['b', 'c']);
    expect(first.candidateIndex).toBe(0);

    const next = reduce(first, key('Tab'), ctx).state as Extract<FsmState, { name: 'connecting' }>;
    expect(next.candidateIndex).toBe(1);
    const back = reduce(next, key('Tab', { shift: true }), ctx).state as Extract<
      FsmState,
      { name: 'connecting' }
    >;
    expect(back.candidateIndex).toBe(0);
  });

  it('Enter creates the edge to the aimed candidate', () => {
    const started = reduce({ name: 'idle' }, key('c'), ctx).state;
    const confirmed = reduce(started, key('Enter'), ctx);
    expect(intentsOf(confirmed.effects)).toEqual([
      {
        t: 'create-edge',
        from: 'a',
        fromAnchor: { side: 'auto', t: 0.5 },
        to: 'b',
        toAnchor: { side: 'auto', t: 0.5 },
      },
    ]);
    expect(confirmed.state.name).toBe('idle');
  });

  it('C without a selected node does nothing', () => {
    expect(reduce({ name: 'idle' }, key('c'), context(nodes)).state.name).toBe('idle');
  });

  it('a keyboard connection with no candidates confirms nothing', () => {
    const alone = context([node('solo', 0, 0)], { selection: ['solo'] });
    const started = reduce({ name: 'idle' }, key('c'), alone).state;
    expect(started).toMatchObject({ name: 'connecting', candidates: [], candidateIndex: -1 });
    const confirmed = reduce(started, key('Enter'), alone);
    expect(intentsOf(confirmed.effects)).toEqual([]);
    expect(confirmed.state.name).toBe('idle');
  });
});
