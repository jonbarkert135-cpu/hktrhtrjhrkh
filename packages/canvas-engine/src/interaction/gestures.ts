/**
 * Input normalization: raw pointer/wheel/keyboard records in, `FsmEvent`s out
 * (05_CANVAS_ENGINE.md §7.3, §7.4, roadmap P2 §8 "trackpad pinch vs Ctrl+wheel vs plain wheel").
 *
 * The DOM never reaches this module: the host adapter copies the four or five fields it needs off a
 * real event into a `Raw*` record. That is what keeps double-click, long-press and two-finger
 * gestures testable against a manual clock in Node.
 */

import type { EngineClock, HitTarget, ResizeHandle, Vec2 } from '../types';
import { DBLCLICK_MAX_MS, DRAG_THRESHOLD_PX, LONG_PRESS_MS } from '../constants';
import type { FsmEvent, FsmState, Modifiers } from './fsm';

export type PointerKind = 'mouse' | 'pen' | 'touch';

export interface RawPointer {
  pointerId: number;
  pointerType: PointerKind;
  button: number;
  screen: Vec2;
  mods: Modifiers;
}

export interface RawWheel {
  deltaX: number;
  deltaY: number;
  /** Browsers report trackpad pinch as a wheel with `ctrlKey` set; that is the only reliable tell. */
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  screen: Vec2;
}

export interface RawKey {
  key: string;
  mods: Modifiers;
  repeat: boolean;
}

export interface GestureDeps {
  clock: EngineClock;
  screenToWorld(p: Vec2): Vec2;
  hitTest(world: Vec2): HitTarget;
  emit(event: FsmEvent): void;
}

export interface GestureNormalizer {
  pointerDown(raw: RawPointer): void;
  pointerMove(raw: RawPointer): void;
  pointerUp(raw: RawPointer): void;
  pointerCancel(pointerId: number): void;
  /** Pointer left the window. Ignored while a gesture holds the pointer (drag survives, §7.5). */
  windowLeave(): void;
  windowEnter(): void;
  wheel(raw: RawWheel): void;
  keyDown(raw: RawKey): void;
  keyUp(raw: RawKey): void;
  blur(): void;
  /** Clears the long-press timer; safe to call twice. */
  dispose(): void;
}

interface ActivePointer {
  pointerType: PointerKind;
  screen: Vec2;
  downAt: number;
}

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function createGestures(deps: GestureDeps): GestureNormalizer {
  const active = new Map<number, ActivePointer>();
  let longPressTimer: number | null = null;
  let lastUp: { time: number; screen: Vec2 } | null = null;
  /** Set while two touch pointers drive the camera; their single-pointer events are suppressed. */
  let pinch: { distance: number; center: Vec2 } | null = null;
  const pinchPointers = new Set<number>();

  const clearLongPress = (): void => {
    if (longPressTimer === null) return;
    deps.clock.clearTimer(longPressTimer);
    longPressTimer = null;
  };

  const pointerEvent = (
    t: 'pointerdown' | 'pointermove' | 'pointerup',
    raw: RawPointer,
  ): FsmEvent => {
    const world = deps.screenToWorld(raw.screen);
    return {
      t,
      pointerId: raw.pointerId,
      button: raw.button,
      screen: raw.screen,
      world,
      target: deps.hitTest(world),
      mods: raw.mods,
      time: deps.clock.now(),
    };
  };

  const touchPair = (): [ActivePointer, ActivePointer] | null => {
    const touches = [...active.values()].filter((p) => p.pointerType === 'touch');
    const a = touches[0];
    const b = touches[1];
    return touches.length === 2 && a !== undefined && b !== undefined ? [a, b] : null;
  };

  return {
    pointerDown(raw: RawPointer): void {
      const now = deps.clock.now();
      active.set(raw.pointerId, { pointerType: raw.pointerType, screen: raw.screen, downAt: now });

      const pair = touchPair();
      if (pair !== null) {
        // Second finger down: abandon whatever the first finger started, switch to pan/pinch.
        clearLongPress();
        for (const id of active.keys()) deps.emit({ t: 'pointercancel', pointerId: id });
        pinch = {
          distance: distance(pair[0].screen, pair[1].screen),
          center: midpoint(pair[0].screen, pair[1].screen),
        };
        for (const id of active.keys()) pinchPointers.add(id);
        return;
      }

      deps.emit(pointerEvent('pointerdown', raw));

      if (
        lastUp !== null &&
        now - lastUp.time <= DBLCLICK_MAX_MS &&
        distance(lastUp.screen, raw.screen) <= DRAG_THRESHOLD_PX
      ) {
        const world = deps.screenToWorld(raw.screen);
        deps.emit({ t: 'dblclick', world, target: deps.hitTest(world) });
        lastUp = null;
        return;
      }

      clearLongPress();
      longPressTimer = deps.clock.setTimer(() => {
        longPressTimer = null;
        const world = deps.screenToWorld(raw.screen);
        deps.emit({ t: 'longpress', world, target: deps.hitTest(world) });
      }, LONG_PRESS_MS);
    },

    pointerMove(raw: RawPointer): void {
      const prev = active.get(raw.pointerId);
      if (prev !== undefined) active.set(raw.pointerId, { ...prev, screen: raw.screen });

      if (pinchPointers.has(raw.pointerId) && pinch === null) return; // pinch is winding down
      const pair = touchPair();
      if (pair !== null && pinch !== null) {
        const d = distance(pair[0].screen, pair[1].screen);
        const center = midpoint(pair[0].screen, pair[1].screen);
        const factor = pinch.distance === 0 ? 1 : d / pinch.distance;
        deps.emit({
          t: 'pinch',
          factor,
          anchorScreen: center,
          panScreen: { x: center.x - pinch.center.x, y: center.y - pinch.center.y },
        });
        pinch = { distance: d, center };
        return;
      }

      if (prev !== undefined && distance(prev.screen, raw.screen) > DRAG_THRESHOLD_PX)
        clearLongPress();
      deps.emit(pointerEvent('pointermove', raw));
    },

    pointerUp(raw: RawPointer): void {
      clearLongPress();
      active.delete(raw.pointerId);
      if (pinchPointers.delete(raw.pointerId)) {
        // Lifting one of two fingers ends the camera gesture; the remaining finger starts nothing.
        pinch = null;
        return;
      }
      deps.emit(pointerEvent('pointerup', raw));
      lastUp = { time: deps.clock.now(), screen: raw.screen };
    },

    pointerCancel(pointerId: number): void {
      clearLongPress();
      active.delete(pointerId);
      pinchPointers.delete(pointerId);
      pinch = null;
      deps.emit({ t: 'pointercancel', pointerId });
    },

    windowLeave(): void {
      if (active.size > 0) return; // captured: the drag continues coherently (§7.5)
      deps.emit({ t: 'pointerleave' });
    },

    windowEnter(): void {
      // Nothing to replay: the next pointermove re-establishes hover from the spatial index.
    },

    wheel(raw: RawWheel): void {
      const zoom = raw.ctrlKey || raw.metaKey;
      const swap = raw.shiftKey && !zoom;
      deps.emit({
        t: 'wheel',
        mode: zoom ? 'zoom' : 'pan',
        deltaX: swap ? raw.deltaY : raw.deltaX,
        deltaY: swap ? raw.deltaX : raw.deltaY,
        anchorScreen: raw.screen,
      });
    },

    keyDown(raw: RawKey): void {
      deps.emit({ t: 'keydown', key: raw.key, mods: raw.mods, repeat: raw.repeat });
    },

    keyUp(raw: RawKey): void {
      deps.emit({ t: 'keyup', key: raw.key, mods: raw.mods });
    },

    blur(): void {
      clearLongPress();
      active.clear();
      pinchPointers.clear();
      pinch = null;
      deps.emit({ t: 'blur' });
    },

    dispose(): void {
      clearLongPress();
      active.clear();
      pinchPointers.clear();
      pinch = null;
    },
  };
}

/* ------------------------------------------------------------------- cursor */

export type Cursor =
  'default' | 'grab' | 'grabbing' | 'crosshair' | 'text' | `${ResizeHandle}-resize`;

const handleCursor = (handle: ResizeHandle): Cursor => `${handle}-resize`;

/** Cursor resolution table from roadmap P2 §6, as a pure function of state + hover target. */
export function cursorFor(state: FsmState, hover: HitTarget): Cursor {
  switch (state.name) {
    case 'editing':
      return 'text';
    case 'panning':
    case 'draggingNodes':
      return 'grabbing';
    case 'spacePan':
      return 'grab';
    case 'marquee':
    case 'connecting':
      return 'crosshair';
    case 'resizing':
      return handleCursor(state.handle);
    case 'pressPending':
      return state.target.t === 'node' ? 'grabbing' : 'crosshair';
    case 'idle':
    case 'hover':
      break;
  }
  switch (hover.t) {
    case 'handle':
      return handleCursor(hover.handle);
    case 'port':
      return 'crosshair';
    case 'node':
    case 'edge':
    case 'canvas':
      return 'default';
  }
}
