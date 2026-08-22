import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useViewportMemory } from './useViewportMemory';
import type { Engine } from '@nexus/canvas-engine';

function fakeEngine(sceneBounds: { x: number; y: number; w: number; h: number }) {
  const listeners: Array<(camera: { x: number; y: number; zoom: number }) => void> = [];
  const camera = {
    state: { x: 0, y: 0, zoom: 1 },
    viewportWorld: { x: 0, y: 0, w: 800, h: 600 },
    fit: vi.fn(),
    fitAll: vi.fn(),
    reset: vi.fn(),
  };
  const engine = {
    camera,
    query: { sceneBounds },
    on: (_event: string, cb: (camera: { x: number; y: number; zoom: number }) => void) => {
      listeners.push(cb);
      return () => listeners.splice(listeners.indexOf(cb), 1);
    },
  };
  return {
    engine: engine as unknown as Engine,
    camera,
    emit: (c: never) => listeners.forEach((l) => l(c)),
  };
}

describe('useViewportMemory', () => {
  it('fits the scene when the board has no remembered viewport', () => {
    localStorage.clear();
    const { engine, camera } = fakeEngine({ x: 0, y: 0, w: 500, h: 400 });
    renderHook(() => useViewportMemory(engine, 'board-1', true));
    expect(camera.fitAll).toHaveBeenCalled();
    expect(camera.fit).not.toHaveBeenCalled();
  });

  it('restores a fresh viewport that still sees the scene', () => {
    localStorage.setItem(
      'raven.viewport.board-2',
      JSON.stringify({ x: 100, y: 50, zoom: 2, savedAt: Date.now(), v: 1 }),
    );
    const { engine, camera } = fakeEngine({ x: 0, y: 0, w: 5000, h: 4000 });
    renderHook(() => useViewportMemory(engine, 'board-2', true));
    expect(camera.fitAll).not.toHaveBeenCalled();
    expect(camera.fit).toHaveBeenCalledWith(expect.objectContaining({ x: 100, y: 50 }), {
      padding: 0,
      maxZoom: 2,
    });
  });

  it('saves the camera as it changes', () => {
    localStorage.clear();
    const { engine, emit } = fakeEngine({ x: 0, y: 0, w: 500, h: 400 });
    const { unmount } = renderHook(() => useViewportMemory(engine, 'board-3', true));
    emit({ x: 12, y: 34, zoom: 1.5 } as never);
    unmount(); // flushes the throttled write
    expect(JSON.parse(localStorage.getItem('raven.viewport.board-3') ?? 'null')).toMatchObject({
      x: 12,
      y: 34,
      zoom: 1.5,
    });
  });

  it('does nothing until the document is ready', () => {
    localStorage.clear();
    const { engine, camera } = fakeEngine({ x: 0, y: 0, w: 500, h: 400 });
    renderHook(() => useViewportMemory(engine, 'board-4', false));
    expect(camera.fitAll).not.toHaveBeenCalled();
  });
});
