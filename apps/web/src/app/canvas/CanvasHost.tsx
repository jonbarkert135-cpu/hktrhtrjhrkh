/**
 * The board surface: one canvas, one absolutely-positioned DOM overlay for near-zoom node hosts,
 * the zoom cluster and the empty-board teaching state (20_ROADMAP P2 §6).
 *
 * React renders this shell exactly once per mount; every frame after that is painted by the engine.
 */

import { useCallback, useRef } from 'react';

import { useCanvasEngine } from './useCanvasEngine';
import type { SceneSnapshot } from '@nexus/canvas-engine';

const ZOOM_STOPS = [0.25, 0.5, 1, 2] as const;

export interface CanvasHostProps {
  scene?: SceneSnapshot;
}

export function CanvasHost({ scene }: CanvasHostProps) {
  const { canvasRef, overlayRef, engineRef, zoom, nodeCount } = useCanvasEngine(
    scene === undefined ? {} : { scene },
  );
  const rootRef = useRef<HTMLDivElement | null>(null);

  const centre = useCallback(() => {
    const box = canvasRef.current?.getBoundingClientRect();
    return { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 };
  }, [canvasRef]);

  const zoomTo = useCallback(
    (value: number) => engineRef.current?.camera.zoomTo(value, centre()),
    [engineRef, centre],
  );

  return (
    <div ref={rootRef} className="nx-canvas-host" data-testid="canvas-host">
      <div
        role="application"
        aria-roledescription="Research canvas"
        aria-label="Board canvas. Drag to pan, scroll to zoom, drag on empty space to select."
        className="nx-canvas-stack"
      >
        <canvas
          ref={canvasRef}
          data-testid="canvas-surface"
          tabIndex={0}
          aria-label="Board canvas. Drag to pan, scroll to zoom, drag on empty space to select."
          className="nx-canvas-surface"
        />
        {/* Node hosts are mounted here by the engine's overlay; React never touches its children. */}
        <div ref={overlayRef} data-testid="canvas-overlay" className="nx-canvas-overlay" />
        {nodeCount === 0 ? (
          <p className="nx-canvas-empty" data-testid="canvas-empty">
            Paste a link, drop a file, or press N for a note
          </p>
        ) : null}
      </div>

      <div className="nx-zoom-cluster" role="group" aria-label="Zoom controls">
        <button
          type="button"
          onClick={() => engineRef.current?.camera.zoomBy(-1, centre())}
          aria-label="Zoom out"
        >
          −
        </button>
        <select
          aria-label="Zoom level"
          value={ZOOM_STOPS.find((s) => Math.abs(s - zoom) < 0.001) ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'fit') engineRef.current?.camera.fitAll();
            else zoomTo(Number(value));
          }}
        >
          <option value="">{Math.round(zoom * 100)}%</option>
          {ZOOM_STOPS.map((stop) => (
            <option key={stop} value={stop}>
              {stop * 100}%
            </option>
          ))}
          <option value="fit">Fit</option>
        </select>
        <button
          type="button"
          onClick={() => engineRef.current?.camera.zoomBy(1, centre())}
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
}
