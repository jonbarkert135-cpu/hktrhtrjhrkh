// Headless routing benchmark (18_TESTING.md §9.1 `route-smart-2000-edges`, 07_EDGE_SYSTEM.md §7.7).
//
// Routing is pure domain code, so it is measured directly instead of through the browser: the
// number is the wall-clock cost of routing 2,000 smart edges over the 5,000-node scene, which is
// exactly what a "fit all + first paint" does on the N1 board.
import { route, withRouteDefaults, type NodeBox, type ObstacleSource } from '@nexus/domain';
import type { Metric, MetricKey } from './harness.ts';
import { BUDGETS, median } from './harness.ts';
import { scene5000 } from './scenes.ts';

const EDGE_SAMPLE = 2000;
const REPETITIONS = 3;
const CARD_RADIUS = 12;

export function runRoutingBenches(): Partial<Record<MetricKey, Metric>> {
  const scene = scene5000();
  const boxes = new Map<string, NodeBox>();
  for (const node of scene.nodes) {
    boxes.set(node.id, {
      id: node.id,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      radius: CARD_RADIUS,
    });
  }

  // A deliberately simple obstacle source: linear scan over a bounded sample. The router's own
  // cost is what is being measured, and a smarter index would hide it.
  const all = [...boxes.values()];
  const obstacles: ObstacleSource = {
    query: (bbox) =>
      all.filter(
        (b) =>
          b.x <= bbox.maxX && b.x + b.w >= bbox.minX && b.y <= bbox.maxY && b.y + b.h >= bbox.minY,
      ),
  };

  const pairs = scene.edges
    .slice(0, EDGE_SAMPLE)
    .map((edge) => [boxes.get(edge.from), boxes.get(edge.to)] as const)
    .filter(
      (pair): pair is readonly [NodeBox, NodeBox] => pair[0] !== undefined && pair[1] !== undefined,
    );

  const samples: number[] = [];
  for (let rep = 0; rep < REPETITIONS; rep += 1) {
    const t0 = performance.now();
    for (const [source, target] of pairs) {
      route(withRouteDefaults({ source, target, mode: 'smart', obstacles }));
    }
    samples.push(performance.now() - t0);
  }

  return {
    'route-smart-2000-edges': {
      value: median(samples),
      unit: 'ms',
      budget: BUDGETS['route-smart-2000-edges'],
      note: `measured headlessly in Node over ${pairs.length} edges of the 5,000-node scene`,
    },
  };
}
