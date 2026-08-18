/**
 * React ⇄ engine seam (20_ROADMAP P2 §4). React owns mounting and layout; the engine owns the
 * frame loop, so this hook is deliberately thin: create on mount, feed DOM events in, tear down on
 * unmount. No engine state is mirrored into React state — that would re-render on every frame.
 */

import {
  createCanvasTarget,
  createEngine,
  createOverlay,
  cursorFor,
  type Engine,
  type EngineClock,
  type Intent,
  type RawPointer,
  type SceneSnapshot,
} from '@nexus/canvas-engine';
import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveEngineTheme } from './engine-theme';

/** Benchmark contract consumed by bench/canvas.bench.ts. */
interface RavenBench {
  readonly readyAt: number;
  readonly nodeCount: number;
  frameTimes(): number[];
  reset(): void;
}

declare global {
  interface Window {
    __ravenBench?: RavenBench;
  }
}

/** The browser clock: rAF for frames, timers for the trailing windows. */
export function createBrowserClock(win: Window): EngineClock {
  return {
    now: () => win.performance.now(),
    requestFrame: (cb) => win.requestAnimationFrame(cb),
    cancelFrame: (handle) => win.cancelAnimationFrame(handle),
    setTimer: (cb, ms) => win.setTimeout(cb, ms),
    clearTimer: (handle) => win.clearTimeout(handle),
  };
}

export interface CanvasEngineHandles {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  /** Live engine handle; null before mount and after unmount. */
  engineRef: React.RefObject<Engine | null>;
  /** Live zoom for the zoom controls; updated on camera events, not per frame. */
  zoom: number;
  /** Node count, so the empty state can disappear on the first node. */
  nodeCount: number;
  /** The overlay slot the engine mounted for a node, for the React card portals (P4 §7). */
  slotOf: (id: string) => HTMLElement | undefined;
}

export interface UseCanvasEngineOptions {
  scene?: SceneSnapshot;
  onIntent?: (intent: Intent) => void;
}

export function useCanvasEngine(options: UseCanvasEngineOptions = {}): CanvasEngineHandles {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // The overlay is created inside the effect; the ref lets the card layer look slots up after it.
  const overlayApiRef = useRef<{ slotOf: (id: string) => HTMLElement | undefined } | null>(null);
  // A ref, not state: the engine must not trigger a React render when it is created or torn down.
  const engineRef = useRef<Engine | null>(null);
  const intentRef = useRef(options.onIntent);
  intentRef.current = options.onIntent;

  const [zoom, setZoom] = useState(1);
  const [nodeCount, setNodeCount] = useState(options.scene?.nodes.length ?? 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlayEl = overlayRef.current;
    if (canvas === null || overlayEl === null) return;
    const win = canvas.ownerDocument.defaultView;
    if (win === null) return;

    // A canvas without a 2D context (headless jsdom, exotic browsers) must not take the board page
    // down with it: the surface simply stays blank.
    if (canvas.getContext('2d') === null) {
      console.error('canvas-engine: no 2D context available; the board surface stays blank');
      return;
    }

    const probe = canvas.ownerDocument.createElement('canvas').getContext('2d', {
      willReadFrequently: true,
    });
    const { theme, metrics } = resolveEngineTheme(canvas, probe);
    const clock = createBrowserClock(win);
    const target = createCanvasTarget(canvas);
    const overlay = createOverlay<HTMLElement>({
      document: canvas.ownerDocument,
      container: overlayEl,
    });
    overlayApiRef.current = overlay;

    const created = createEngine({
      target,
      clock,
      theme,
      metrics,
      overlay,
      ...(options.scene === undefined ? {} : { initialScene: options.scene }),
      prefersReducedMotion: win.matchMedia('(prefers-reduced-motion: reduce)').matches,
      capturePointer: (id) => canvas.setPointerCapture(id),
      releasePointer: (id) => {
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      },
    });
    engineRef.current = created;

    const mods = (e: PointerEvent | KeyboardEvent | WheelEvent) => ({
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey,
      meta: e.metaKey,
    });
    const local = (e: PointerEvent | WheelEvent) => {
      const box = canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const raw = (e: PointerEvent): RawPointer => ({
      pointerId: e.pointerId,
      pointerType: e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse',
      button: e.button,
      screen: local(e),
      mods: mods(e),
    });

    const onPointerDown = (e: PointerEvent) => {
      canvas.focus();
      created.input.pointerDown(raw(e));
    };
    const onPointerMove = (e: PointerEvent) => created.input.pointerMove(raw(e));
    const onPointerUp = (e: PointerEvent) => created.input.pointerUp(raw(e));
    const onPointerCancel = (e: PointerEvent) => created.input.pointerCancel(e.pointerId);
    const onWheel = (e: WheelEvent) => {
      // Ctrl+wheel is the browser's page-zoom gesture; the canvas owns it instead (05 §5.5).
      e.preventDefault();
      created.input.wheel({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        screen: local(e),
      });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      created.input.keyDown({ key: e.key, mods: mods(e), repeat: e.repeat });
    };
    const onKeyUp = (e: KeyboardEvent) =>
      created.input.keyUp({ key: e.key, mods: mods(e), repeat: e.repeat });
    const onBlur = () => created.input.blur();
    const onVisibility = () => created.setPaused(canvas.ownerDocument.hidden);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('blur', onBlur);
    canvas.ownerDocument.addEventListener('visibilitychange', onVisibility);

    // Bench hook: real frame durations straight from the engine, no sampling wrapper (16_PERFORMANCE).
    let frameTimes: number[] = [];
    const readyAt = win.performance.now();
    const offFrame = created.on('frame', (stats) => frameTimes.push(stats.duration));
    win.__ravenBench = {
      readyAt,
      get nodeCount() {
        return created.query.nodeCount;
      },
      frameTimes: () => [...frameTimes],
      reset: () => {
        frameTimes = [];
      },
    };

    const offCamera = created.on('cameraChanged', (state) => setZoom(state.zoom));
    const offIntent = created.on('intent', (intent) => {
      if (intent.t !== 'camera') setNodeCount(created.query.nodeCount);
      intentRef.current?.(intent);
    });
    const offHover = created.on('hoverChanged', (target) => {
      canvas.style.cursor = cursorFor({ name: 'idle' }, target);
    });

    const observer = new win.ResizeObserver(() => {
      const box = canvas.getBoundingClientRect();
      created.setViewport(box.width, box.height, Math.min(win.devicePixelRatio, 2));
    });
    observer.observe(canvas);
    const box = canvas.getBoundingClientRect();
    created.setViewport(box.width, box.height, Math.min(win.devicePixelRatio, 2));

    return () => {
      observer.disconnect();
      offFrame();
      delete win.__ravenBench;
      offCamera();
      offIntent();
      offHover();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('blur', onBlur);
      canvas.ownerDocument.removeEventListener('visibilitychange', onVisibility);
      created.dispose();
      engineRef.current = null;
      overlayApiRef.current = null;
    };
    // The engine is created once per mount; scene updates go through `applyScenePatch`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slotOf = useCallback((id: string) => overlayApiRef.current?.slotOf(id), []);

  return { canvasRef, overlayRef, engineRef, zoom, nodeCount, slotOf };
}
