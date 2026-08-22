/**
 * Personal viewport memory (05_CANVAS_ENGINE.md §5.7): reopening a board lands the analyst where
 * they left off instead of at the origin. The store already exists in the engine package; this hook
 * is only the browser seam — `localStorage` in, camera events out.
 */

import {
  createViewportStore,
  shouldRestore,
  viewportWorldRect,
  type Engine,
} from '@nexus/canvas-engine';
import { useEffect } from 'react';

import { createBrowserClock } from './useCanvasEngine';

/** Restores once per board, then keeps the camera saved (throttled by the store itself). */
export function useViewportMemory(engine: Engine | null, boardId: string, ready: boolean): void {
  useEffect(() => {
    if (engine === null || !ready) return undefined;
    const win = globalThis.window as Window | undefined;
    if (win === undefined) return undefined;

    const clock = createBrowserClock(win);
    let storage;
    try {
      storage = win.localStorage;
    } catch {
      return undefined; // storage-denied browser: the board still works, it just forgets.
    }
    const store = createViewportStore(storage, clock);

    const persisted = store.load(boardId);
    const view = engine.camera.viewportWorld;
    const viewport = {
      width: view.w * engine.camera.state.zoom,
      height: view.h * engine.camera.state.zoom,
    };
    const decision = shouldRestore(persisted, engine.query.sceneBounds, viewport, clock.now());
    if (decision === 'restore' && persisted !== null) {
      // No `setState` on the camera by design; fitting the saved world rect reproduces it exactly,
      // because the rect was derived from this same viewport.
      engine.camera.fit(viewportWorldRect(persisted, viewport.width, viewport.height), {
        padding: 0,
        maxZoom: persisted.zoom,
      });
    } else if (decision === 'fit-all') {
      engine.camera.fitAll();
    } else {
      engine.camera.reset();
    }

    const off = engine.on('cameraChanged', (camera) => store.save(boardId, camera));
    const onHide = () => store.flush();
    win.addEventListener('pagehide', onHide);

    return () => {
      off();
      win.removeEventListener('pagehide', onHide);
      store.flush();
      store.dispose();
    };
  }, [engine, boardId, ready]);
}
