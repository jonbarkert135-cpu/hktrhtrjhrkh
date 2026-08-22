/**
 * Force-directed layout (Fruchterman–Reingold with a cooling schedule). Two departures from the
 * textbook, both for N1:
 *
 * 1. Repulsion is evaluated against a uniform grid neighbourhood instead of all pairs, so the cost
 *    is O(n · k) per iteration rather than O(n²) — a 5,000-node board is otherwise 12.5 M pair
 *    evaluations per iteration.
 * 2. The initial positions come from a seeded PRNG, never from `Math.random`, so the same board
 *    laid out twice is pixel-identical (`determinism` test).
 */

import type { Placement } from '../overlap.ts';
import { hashString } from '../rng.ts';
import { checkpoint, placementOf, type AlgorithmInput } from './shared.ts';

export const DEFAULT_FORCE_ITERATIONS = 120;

export function force(input: AlgorithmInput): Placement[] {
  const { view, options, ctx } = input;
  const ids = view.ids;
  const count = ids.length;
  if (count === 0) return [];

  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const w = new Float64Array(count);
  const h = new Float64Array(count);

  // Ideal edge length scales with card size so big cards do not end up on top of each other.
  let area = 0;
  ids.forEach((id, i) => {
    const node = view.nodeById.get(id);
    w[i] = node?.w ?? 1;
    h[i] = node?.h ?? 1;
    area += (node?.w ?? 1) * (node?.h ?? 1);
  });
  const k = Math.sqrt((area * 4) / count) + options.spacingX;
  const radius = Math.sqrt(count) * k * 0.5;

  // Seeded, id-derived start: adding an unrelated node does not reshuffle the others.
  ids.forEach((id, i) => {
    const hash = hashString(`${String(options.seed)}:${id}`);
    const angle = ((hash % 4096) / 4096) * Math.PI * 2;
    const r = Math.sqrt(((hash >>> 12) % 4096) / 4096) * radius;
    xs[i] = Math.cos(angle) * r;
    ys[i] = Math.sin(angle) * r;
  });

  const edges = view.edges
    .map((edge) => ({ a: index.get(edge.source), b: index.get(edge.target) }))
    .filter((e): e is { a: number; b: number } => e.a !== undefined && e.b !== undefined);

  const iterations = Math.max(1, options.iterations);
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);
  const cell = k * 2;

  for (let step = 0; step < iterations; step += 1) {
    checkpoint(ctx, step / iterations);
    dx.fill(0);
    dy.fill(0);

    const buckets = new Map<number, number[]>();
    const cellKey = (cx: number, cy: number): number => cx * 73856093 + cy * 19349663;
    for (let i = 0; i < count; i += 1) {
      const key = cellKey(
        Math.floor((xs[i] as number) / cell),
        Math.floor((ys[i] as number) / cell),
      );
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [i]);
      else bucket.push(i);
    }

    for (let i = 0; i < count; i += 1) {
      const cx = Math.floor((xs[i] as number) / cell);
      const cy = Math.floor((ys[i] as number) / cell);
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          for (const j of buckets.get(cellKey(cx + ox, cy + oy)) ?? []) {
            if (j <= i) continue;
            let vx = (xs[i] as number) - (xs[j] as number);
            let vy = (ys[i] as number) - (ys[j] as number);
            let dist = Math.hypot(vx, vy);
            if (dist < 0.01) {
              // Perfectly coincident nodes need a deterministic nudge, not a random one.
              vx = ((i % 7) - 3) * 0.01 + 0.01;
              vy = ((j % 5) - 2) * 0.01 + 0.01;
              dist = Math.hypot(vx, vy);
            }
            const repulse = (k * k) / dist;
            dx[i] = (dx[i] as number) + (vx / dist) * repulse;
            dy[i] = (dy[i] as number) + (vy / dist) * repulse;
            dx[j] = (dx[j] as number) - (vx / dist) * repulse;
            dy[j] = (dy[j] as number) - (vy / dist) * repulse;
          }
        }
      }
    }

    for (const edge of edges) {
      const vx = (xs[edge.a] as number) - (xs[edge.b] as number);
      const vy = (ys[edge.a] as number) - (ys[edge.b] as number);
      const dist = Math.max(0.01, Math.hypot(vx, vy));
      const attract = (dist * dist) / k;
      dx[edge.a] = (dx[edge.a] as number) - (vx / dist) * attract;
      dy[edge.a] = (dy[edge.a] as number) - (vy / dist) * attract;
      dx[edge.b] = (dx[edge.b] as number) + (vx / dist) * attract;
      dy[edge.b] = (dy[edge.b] as number) + (vy / dist) * attract;
    }

    // Disconnected nodes drift forever under repulsion alone; a weak pull towards the origin
    // keeps the board bounded without changing the relative shape of the graph.
    const gravity = 0.0004 * k;
    for (let i = 0; i < count; i += 1) {
      dx[i] = (dx[i] as number) - (xs[i] as number) * gravity;
      dy[i] = (dy[i] as number) - (ys[i] as number) * gravity;
    }

    // Cooling: the maximum displacement shrinks linearly to zero, which is what makes the run
    // converge instead of oscillating.
    const temperature = k * (1 - step / iterations);
    for (let i = 0; i < count; i += 1) {
      const dist = Math.hypot(dx[i] as number, dy[i] as number);
      if (dist < 1e-9) continue;
      const limit = Math.min(dist, temperature);
      xs[i] = (xs[i] as number) + ((dx[i] as number) / dist) * limit;
      ys[i] = (ys[i] as number) + ((dy[i] as number) / dist) * limit;
    }
  }

  const placements: Placement[] = [];
  ids.forEach((id, i) => {
    const node = view.nodeById.get(id);
    if (node === undefined) return;
    placements.push(
      placementOf(node, (xs[i] as number) - node.w / 2, (ys[i] as number) - node.h / 2),
    );
  });
  return placements;
}
