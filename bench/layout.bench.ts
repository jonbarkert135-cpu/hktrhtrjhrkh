// Auto-layout benchmark (18_TESTING.md §9.1 `autolayout-1000`, P14a).
//
// Measured in Node against the real `@nexus/layout` engine, which is exactly the code the worker
// runs — there is no DOM, no canvas and no React in that path, so the Node number *is* the worker
// number, minus the structured-clone of the request. The 5,000-node figure is recorded as a note
// so an O(n²) regression is visible long before it reaches the 1,000-node budget.
import { proposeLayout, type LayoutEdge, type LayoutGraph, type LayoutNode } from '@nexus/layout';
import type { Metric, MetricKey } from './harness.ts';
import { BUDGETS, median } from './harness.ts';

const REPETITIONS = 3;

/** Same shape as the canvas scenes: a seeded, deterministic board. */
export function layoutScene(nodes: number, edgesPerNode = 2): LayoutGraph {
  const list: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  for (let i = 0; i < nodes; i += 1) {
    list.push({
      id: `n${String(i)}`,
      x: (i % 50) * 360,
      y: Math.floor(i / 50) * 240,
      w: 280 + (i % 3) * 40,
      h: 160 + (i % 2) * 40,
      observedAt: new Date(Date.UTC(2026, 0, 1 + (i % 365))).toISOString(),
      group: `g${String(i % 9)}`,
    });
    for (let k = 0; k < edgesPerNode && i > 0; k += 1) {
      const from = (i * 7 + k * 13) % i;
      edges.push({
        id: `e${String(i)}_${String(k)}`,
        source: `n${String(from)}`,
        target: `n${String(i)}`,
      });
    }
  }
  return { nodes: list, edges };
}

function timed(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

export function runLayoutBenches(): Partial<Record<MetricKey, Metric>> {
  const scene1000 = layoutScene(1000);
  const scene5000 = layoutScene(5000);

  // The budget covers the layout the user actually triggers, so the worst algorithm wins the
  // number: reporting the cheapest one would hide a regression in the expensive one.
  const algorithms = [
    'hierarchical',
    'tree',
    'radial',
    'force',
    'flow',
    'timeline',
    'cluster',
  ] as const;
  const perAlgorithm = algorithms.map((algorithm) => {
    const samples: number[] = [];
    for (let i = 0; i < REPETITIONS; i += 1) {
      samples.push(timed(() => void proposeLayout(scene1000, { algorithm })));
    }
    return { algorithm, ms: median(samples) };
  });
  const worst = perAlgorithm.reduce((a, b) => (b.ms > a.ms ? b : a));
  const big = median([
    timed(() => void proposeLayout(scene5000, { algorithm: 'hierarchical' })),
    timed(() => void proposeLayout(scene5000, { algorithm: 'hierarchical' })),
  ]);

  return {
    'autolayout-1000': {
      value: worst.ms,
      unit: 'ms',
      budget: BUDGETS['autolayout-1000'],
      note:
        `worst of ${String(algorithms.length)} algorithms (${worst.algorithm}) on 1,000 nodes / ` +
        `2,000 edges, measured in Node; hierarchical on 5,000 nodes / 10,000 edges: ` +
        `${big.toFixed(1)} ms. Runs in a worker in the app, so it never blocks a frame.`,
    },
  };
}
