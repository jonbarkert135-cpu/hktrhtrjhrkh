/**
 * Mounts the engine's minimap onto its own canvas (20_ROADMAP P2 §5 req 14, acceptance 6).
 *
 * The minimap owns its repaint budget (10 fps, only when dirty), so the host does not drive it from
 * the main frame loop: a plain interval is enough and cannot double the per-frame cost.
 */

import { createCanvasTarget, createMinimap, type Engine } from '@nexus/canvas-engine';
import { useEffect } from 'react';

import { resolveEngineTheme } from './engine-theme';
import { createBrowserClock } from './useCanvasEngine';

/** CSS px; must match `.nx-minimap` in app.css. */
export const MINIMAP_WIDTH = 200;
export const MINIMAP_HEIGHT = 140;
const TICK_MS = 100;

export function useMinimap(
  engineRef: React.RefObject<Engine | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): void {
  useEffect(() => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (engine === null || canvas === null) return;
    const win = canvas.ownerDocument.defaultView;
    if (win === null || canvas.getContext('2d') === null) return;

    const { theme } = resolveEngineTheme(canvas, null);
    const target = createCanvasTarget(canvas);
    target.resize(MINIMAP_WIDTH, MINIMAP_HEIGHT, Math.min(win.devicePixelRatio, 2));
    const minimap = createMinimap({
      target,
      clock: createBrowserClock(win),
      query: engine.query,
      camera: engine.camera,
      theme,
    });

    const offCamera = engine.on('cameraChanged', () => minimap.invalidate());
    const offIntent = engine.on('intent', () => minimap.invalidate());
    const timer = win.setInterval(() => minimap.tick(), TICK_MS);

    const local = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    let dragging = false;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      minimap.jumpTo(local(e));
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) minimap.panTo(local(e));
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      win.clearInterval(timer);
      offCamera();
      offIntent();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      minimap.dispose();
    };
  }, [engineRef, canvasRef]);
}
