import { useEffect, useRef } from 'react';
import { createFpsSampler, drawGrid, resizeToDisplay, type Camera } from './grid';

declare global {
  interface Window {
    __nexusBench?: { fps: number; p95FrameMs: number; frames: number };
  }
}

// ponytail: placeholder surface for P1 only — proves the rAF loop, DPR sizing and the bench hook.
// The real renderer is packages/canvas-engine in P2 and this component is deleted then.
export function PlaceholderSurface() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const styles = getComputedStyle(canvas);
    const colors = {
      void: styles.getPropertyValue('--canvas-void').trim() || 'transparent',
      line: styles.getPropertyValue('--canvas-grid-line').trim() || 'transparent',
    };

    const camera: Camera = { x: 0, y: 0 };
    const sampler = createFpsSampler();
    let pointerId: number | null = null;
    let last: { x: number; y: number } | null = null;
    let previousTime = performance.now();
    let frame = 0;

    const onPointerDown = (event: PointerEvent) => {
      pointerId = event.pointerId;
      last = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId || !last) return;
      camera.x += event.clientX - last.x;
      camera.y += event.clientY - last.y;
      last = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      last = null;
      canvas.releasePointerCapture(event.pointerId);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    const tick = (now: number) => {
      sampler.sample(now - previousTime);
      previousTime = now;
      window.__nexusBench = sampler.metrics();
      drawGrid(ctx, camera, resizeToDisplay(canvas), colors);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      delete window.__nexusBench;
    };
  }, []);

  return (
    // The application role lives on the wrapper: <canvas> is already an interactive element and
    // cannot carry a non-interactive role (jsx-a11y/no-interactive-element-to-noninteractive-role).
    <div
      role="application"
      aria-roledescription="Research canvas"
      aria-label="Board canvas. Drag to pan. Nodes arrive in a later release."
      style={{ width: '100%', height: '100%' }}
    >
      <canvas
        ref={canvasRef}
        data-testid="placeholder-surface"
        tabIndex={0}
        aria-label="Board canvas. Drag to pan. Nodes arrive in a later release."
        style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
      />
    </div>
  );
}
