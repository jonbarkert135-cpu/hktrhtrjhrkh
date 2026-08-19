/**
 * Waypoint gestures (P5 part 4 §1): double-click inserts, drag moves, right-click deletes, and each
 * of them is exactly one intent the host turns into one undo step.
 */

import { describe, expect, it } from 'vitest';

import { context, intentsOf, node, pointer, run, at, NO_MODS } from './fsm.support';
import { reduce } from '../src/interaction/fsm';
import type { HitTarget } from '../src/types';

const nodes = [node('a', 0, 0), node('b', 400, 0)];
const onEdge: HitTarget = { t: 'edge', id: 'e1' };
const onWaypoint: HitTarget = { t: 'waypoint', id: 'e1', index: 1 };

describe('waypoint editing', () => {
  it('double-clicking an edge inserts a waypoint at that point', () => {
    const result = reduce(
      { name: 'idle' },
      { t: 'dblclick', world: at(200, 40), target: onEdge },
      context(nodes),
    );
    expect(intentsOf(result.effects)).toEqual([
      { t: 'edge-waypoint', op: 'insert', edgeId: 'e1', at: { x: 200, y: 40 } },
    ]);
    // The edge is not put into text editing — that is a node affordance.
    expect(result.state.name).toBe('idle');
  });

  it('dragging a waypoint emits start / update / end for one undo step', () => {
    const script = run(
      [
        pointer('pointerdown', at(200, 40), onWaypoint),
        pointer('pointermove', at(220, 80), onWaypoint),
        pointer('pointerup', at(240, 90), onWaypoint),
      ],
      context(nodes),
    );
    expect(intentsOf(script.all)).toEqual([
      {
        t: 'edge-waypoint',
        op: 'move',
        edgeId: 'e1',
        index: 1,
        at: { x: 200, y: 40 },
        phase: 'start',
      },
      {
        t: 'edge-waypoint',
        op: 'move',
        edgeId: 'e1',
        index: 1,
        at: { x: 220, y: 80 },
        phase: 'update',
      },
      {
        t: 'edge-waypoint',
        op: 'move',
        edgeId: 'e1',
        index: 1,
        at: { x: 240, y: 90 },
        phase: 'end',
      },
    ]);
    expect(script.state.name).toBe('idle');
  });

  it('escape cancels the drag instead of leaving it half-applied', () => {
    const down = reduce(
      { name: 'idle' },
      pointer('pointerdown', at(200, 40), onWaypoint),
      context(nodes),
    );
    const cancelled = reduce(
      down.state,
      { t: 'keydown', key: 'Escape', mods: NO_MODS, repeat: false },
      context(nodes),
    );
    expect(intentsOf(cancelled.effects)).toEqual([
      {
        t: 'edge-waypoint',
        op: 'move',
        edgeId: 'e1',
        index: 1,
        at: { x: 200, y: 40 },
        phase: 'cancel',
      },
    ]);
    expect(cancelled.state.name).toBe('idle');
  });

  it('right-clicking a waypoint deletes it and opens no menu', () => {
    const result = reduce(
      { name: 'idle' },
      { t: 'contextmenu', world: at(200, 40), target: onWaypoint },
      context(nodes),
    );
    expect(intentsOf(result.effects)).toEqual([
      { t: 'edge-waypoint', op: 'delete', edgeId: 'e1', index: 1 },
    ]);
  });

  it('right-clicking the edge itself still opens the relationship menu', () => {
    const result = reduce(
      { name: 'idle' },
      { t: 'contextmenu', world: at(200, 40), target: onEdge },
      context(nodes),
    );
    expect(intentsOf(result.effects).map((i) => i.t)).toEqual(['select', 'context-menu']);
  });
});
