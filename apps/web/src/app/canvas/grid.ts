// ponytail: throwaway grid painter. The real hybrid engine (camera, spatial index, LOD,
// interaction FSM) lands in P2 as packages/canvas-engine; this file is deleted then.
// Ceiling: one grid layer, no culling, no scene, no zoom.

export type Camera = { x: number; y: number };

const GRID_STEP_PX = 32;
const MAX_DPR = 2;

export function resizeToDisplay(canvas: HTMLCanvasElement): number {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return dpr;
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  dpr: number,
  colors: { void: string; line: string },
): void {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colors.void;
  ctx.fillRect(0, 0, width, height);

  const step = GRID_STEP_PX * dpr;
  const offsetX = ((camera.x * dpr) % step + step) % step;
  const offsetY = ((camera.y * dpr) % step + step) % step;

  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = offsetX; x < width; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = offsetY; y < height; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }
  ctx.stroke();
}

/** Rolling fps sampler; the bench harness reads it off window.__nexusBench. */
export function createFpsSampler() {
  const frames: number[] = [];
  return {
    sample(deltaMs: number) {
      frames.push(deltaMs);
      if (frames.length > 240) frames.shift();
    },
    metrics() {
      if (frames.length === 0) return { fps: 0, p95FrameMs: 0, frames: 0 };
      const sorted = [...frames].sort((a, b) => a - b);
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? mean;
      return { fps: mean > 0 ? 1000 / mean : 0, p95FrameMs: p95, frames: frames.length };
    },
  };
}
