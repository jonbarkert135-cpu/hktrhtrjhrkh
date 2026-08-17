/**
 * Shared fixtures for the interaction tests: a hand-rolled `SceneQuery`, node factory and pointer
 * script builder. No DOM, no engine: the FSM is a pure reducer, so the harness is a few objects.
 */

import type { EntityId, HitTarget, NodeId, NodeView, Rect, SceneQuery, Vec2 } from '../src/types';
import type { FsmContext, FsmEvent, FsmState, Modifiers } from '../src/interaction/fsm';
import { reduce } from '../src/interaction/fsm';

export const NO_MODS: Modifiers = { shift: false, alt: false, ctrl: false, meta: false };
export const mods = (over: Partial<Modifiers>): Modifiers => ({ ...NO_MODS, ...over });

let seq = 0;

export function node(
  id: NodeId,
  x: number,
  y: number,
  w = 100,
  h = 60,
  over: Partial<NodeView> = {},
): NodeView {
  seq += 1;
  return {
    id,
    kind: 'note',
    x,
    y,
    w,
    h,
    z: seq,
    layerId: 'base',
    groupId: null,
    rotation: 0,
    locked: false,
    hidden: false,
    glyph: {
      accent: { r: 0, g: 0, b: 0, a: 1 },
      fill: { r: 1, g: 1, b: 1, a: 1 },
      icon: 'note',
      title: id,
      badgeCount: 0,
      thumbnailKey: null,
      status: 'none',
    },
    domKey: `dom-${id}`,
    visualVersion: 1,
    ...over,
  };
}

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

const rectOf = (n: NodeView): Rect => ({ x: n.x, y: n.y, w: n.w, h: n.h });

export function scene(nodes: readonly NodeView[]): SceneQuery {
  const visible = nodes.filter((n) => !n.hidden);
  return {
    nodesIn: (rect) => visible.filter((n) => intersects(rectOf(n), rect)),
    nodesContainedIn: (rect) => visible.filter((n) => contains(rect, rectOf(n))),
    nodeAt: (p) =>
      [...visible]
        .reverse()
        .find((n) => intersects(rectOf(n), { x: p.x, y: p.y, w: 0.001, h: 0.001 })) ?? null,
    node: (id) => nodes.find((n) => n.id === id),
    edge: () => undefined,
    sceneBounds: { x: -1e5, y: -1e5, w: 2e5, h: 2e5 },
    nodeCount: nodes.length,
  };
}

export function context(nodes: readonly NodeView[], over: Partial<FsmContext> = {}): FsmContext {
  return {
    scene: scene(nodes),
    selection: [],
    zoom: 1,
    viewportWorld: { x: -1000, y: -1000, w: 4000, h: 4000 },
    features: { snapToGrid: false, alignmentGuides: false },
    ...over,
  };
}

export const at = (x: number, y: number): Vec2 => ({ x, y });

/** Pointer events use world === screen: every test here runs at zoom 1 with no camera offset. */
export function pointer(
  t: 'pointerdown' | 'pointermove' | 'pointerup',
  p: Vec2,
  target: HitTarget = { t: 'canvas' },
  over: { button?: number; mods?: Modifiers; time?: number; pointerId?: number } = {},
): FsmEvent {
  return {
    t,
    pointerId: over.pointerId ?? 1,
    button: over.button ?? 0,
    screen: p,
    world: p,
    target,
    mods: over.mods ?? NO_MODS,
    time: over.time ?? 0,
  };
}

export const onNode = (id: NodeId): HitTarget => ({ t: 'node', id });

export interface RunResult {
  state: FsmState;
  effects: ReturnType<typeof reduce>['effects'];
  /** Every effect emitted across the whole script, in order. */
  all: ReturnType<typeof reduce>['effects'];
}

/** Feeds a script through the reducer, threading state and collecting effects. */
export function run(
  events: readonly FsmEvent[],
  ctx: FsmContext,
  from: FsmState = { name: 'idle' },
): RunResult {
  let state = from;
  let last: ReturnType<typeof reduce> = { state, effects: [] };
  const all: Array<RunResult['effects'][number]> = [];
  for (const event of events) {
    last = reduce(state, event, ctx);
    state = last.state;
    all.push(...last.effects);
  }
  return { state, effects: last.effects, all };
}

export const intentsOf = (
  effects: RunResult['effects'],
): Array<Extract<RunResult['effects'][number], { t: 'intent' }>['intent']> =>
  effects.flatMap((e) => (e.t === 'intent' ? [e.intent] : []));

export const selectionOf = (ids: readonly EntityId[]): FsmContext['selection'] => ids;
