/**
 * Minimap (20_ROADMAP P2 §5 req 14, acceptance 6).
 *
 * A second, independent render target: it is decoupled from the main loop and repaints at most
 * `MINIMAP_MAX_FPS` times per second, because a minimap that repaints with the canvas would double
 * the per-frame cost for a widget nobody looks at while dragging.
 */

import { MINIMAP_MAX_FPS } from './constants';
import type {
  CameraController,
  EngineClock,
  EngineTheme,
  NodeView,
  Rect,
  RenderTarget,
  SceneQuery,
  Vec2,
} from './types';

const MIN_FRAME_MS = 1000 / MINIMAP_MAX_FPS;
/** Padding around the scene bounds, in minimap px, so nodes at the edge stay visible. */
const PAD_PX = 6;

export interface MinimapOptions {
  target: RenderTarget;
  clock: EngineClock;
  query: SceneQuery;
  camera: CameraController;
  theme: EngineTheme;
}

export interface Minimap {
  /** Marks the minimap dirty; the next `tick` inside the frame budget repaints. */
  invalidate(): void;
  /** Repaints if dirty and at least 1/10 s has passed. Returns true when it painted. */
  tick(now?: number): boolean;
  /** Click-to-jump: centres the camera on the world point under a minimap-local point. */
  jumpTo(local: Vec2): void;
  /** Drag-to-pan: same math, called on every move while the pointer is down. */
  panTo(local: Vec2): void;
  /** World rect currently mapped onto the minimap (scene bounds unioned with the viewport). */
  readonly worldRect: Rect;
  dispose(): void;
}

interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
  world: Rect;
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

export function createMinimap(options: MinimapOptions): Minimap {
  const { target, clock, query, camera, theme } = options;
  let dirty = true;
  let lastPaint = Number.NEGATIVE_INFINITY;
  let disposed = false;
  let fit: Fit = { scale: 1, offsetX: 0, offsetY: 0, world: { x: 0, y: 0, w: 1, h: 1 } };

  const computeFit = (): Fit => {
    const view = camera.viewportWorld;
    const scene = query.nodeCount === 0 ? view : unionRect(query.sceneBounds, view);
    const w = Math.max(scene.w, 1);
    const h = Math.max(scene.h, 1);
    const usableW = Math.max(target.size.width - PAD_PX * 2, 1);
    const usableH = Math.max(target.size.height - PAD_PX * 2, 1);
    const scale = Math.min(usableW / w, usableH / h);
    return {
      scale,
      offsetX: PAD_PX + (usableW - w * scale) / 2,
      offsetY: PAD_PX + (usableH - h * scale) / 2,
      world: { x: scene.x, y: scene.y, w, h },
    };
  };

  const toLocal = (p: Vec2): Vec2 => ({
    x: fit.offsetX + (p.x - fit.world.x) * fit.scale,
    y: fit.offsetY + (p.y - fit.world.y) * fit.scale,
  });

  const toWorld = (local: Vec2): Vec2 => ({
    x: fit.world.x + (local.x - fit.offsetX) / fit.scale,
    y: fit.world.y + (local.y - fit.offsetY) / fit.scale,
  });

  const centreOn = (local: Vec2): void => {
    const world = toWorld(local);
    const view = camera.viewportWorld;
    const zoom = camera.state.zoom;
    // Pan so the requested world point lands in the middle of the main viewport.
    // ponytail: panBy commits with cause 'user'; a dedicated 'minimap' cause would need the
    // concrete Camera instead of the CameraController seam, and nothing consumes the cause yet.
    camera.panBy((world.x - view.w / 2 - view.x) * zoom, (world.y - view.h / 2 - view.y) * zoom);
    dirty = true;
  };

  const paint = (): void => {
    fit = computeFit();
    const ctx = target.beginFrame();
    ctx.clear(theme.canvasBackground);
    const nodes: NodeView[] = query.nodesIn(fit.world);
    for (const node of nodes) {
      if (node.hidden) continue;
      const p = toLocal({ x: node.x, y: node.y });
      ctx.rect(
        { x: p.x, y: p.y, w: Math.max(node.w * fit.scale, 1), h: Math.max(node.h * fit.scale, 1) },
        theme.minimapNode,
        null,
      );
    }
    const view = camera.viewportWorld;
    const vp = toLocal({ x: view.x, y: view.y });
    ctx.rect(
      { x: vp.x, y: vp.y, w: view.w * fit.scale, h: view.h * fit.scale },
      null,
      theme.minimapViewport,
      1,
    );
    target.endFrame();
  };

  return {
    invalidate(): void {
      dirty = true;
    },
    tick(now: number = clock.now()): boolean {
      if (disposed || !dirty || now - lastPaint < MIN_FRAME_MS) return false;
      lastPaint = now;
      dirty = false;
      paint();
      return true;
    },
    jumpTo(local: Vec2): void {
      if (disposed) return;
      fit = computeFit();
      centreOn(local);
    },
    panTo(local: Vec2): void {
      if (disposed) return;
      centreOn(local);
    },
    get worldRect(): Rect {
      return fit.world;
    },
    dispose(): void {
      disposed = true;
      target.dispose();
    },
  };
}
