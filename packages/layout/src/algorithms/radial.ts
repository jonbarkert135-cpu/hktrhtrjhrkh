/**
 * Radial layout: the most connected node of each component sits at the centre, its BFS levels sit
 * on concentric rings, and each subtree gets an angular wedge proportional to how many leaves it
 * carries — the arrangement that makes "everything hangs off this one account" obvious at a glance.
 */

import type { AdjacencyView } from '../graph.ts';
import { components } from '../graph.ts';
import type { Placement } from '../overlap.ts';
import { checkpoint, placementOf, type AlgorithmInput } from './shared.ts';

function centreOf(view: AdjacencyView, group: readonly string[]): string {
  let best = group[0] as string;
  let bestDegree = -1;
  for (const id of group) {
    const degree = (view.neighbours.get(id) ?? []).length;
    // `>` keeps the first node of the input order on a tie, which keeps re-runs stable.
    if (degree > bestDegree) {
      best = id;
      bestDegree = degree;
    }
  }
  return best;
}

export function radial(input: AlgorithmInput): Placement[] {
  const { view, options, ctx } = input;
  const placements: Placement[] = [];
  const groups = components(view);
  let clusterX = 0;
  let clusterY = 0;
  let rowHeight = 0;

  groups.forEach((group, index) => {
    checkpoint(ctx, (index / Math.max(1, groups.length)) * 0.9);
    const root = centreOf(view, group);
    const level = new Map<string, number>([[root, 0]]);
    const parent = new Map<string, string | null>([[root, null]]);
    const children = new Map<string, string[]>();
    for (const id of group) children.set(id, []);
    const queue = [root];
    let cursor = 0;
    while (cursor < queue.length) {
      const id = queue[cursor] as string;
      cursor += 1;
      for (const next of view.neighbours.get(id) ?? []) {
        if (level.has(next)) continue;
        level.set(next, (level.get(id) ?? 0) + 1);
        parent.set(next, id);
        children.get(id)?.push(next);
        queue.push(next);
      }
    }

    // Leaf counts drive the wedge width; computed bottom-up over the BFS order, reversed.
    const leaves = new Map<string, number>();
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      const id = queue[i] as string;
      const kids = children.get(id) ?? [];
      leaves.set(
        id,
        kids.length === 0 ? 1 : kids.reduce((sum, kid) => sum + (leaves.get(kid) ?? 1), 0),
      );
    }

    const maxLevel = Math.max(0, ...group.map((id) => level.get(id) ?? 0));

    // Ring radii are computed, not stepped: a ring must be big enough both to clear the previous
    // ring and to seat everything on it around its own circumference. A fixed step is what makes
    // naive radial layouts pile 200 cards on top of each other two rings out.
    const perLevel: Array<{ count: number; width: number; height: number }> = Array.from(
      { length: maxLevel + 1 },
      () => ({ count: 0, width: 0, height: 0 }),
    );
    for (const id of group) {
      const node = view.nodeById.get(id);
      const slot = perLevel[level.get(id) ?? 0];
      if (node === undefined || slot === undefined) continue;
      slot.count += 1;
      slot.width = Math.max(slot.width, node.w);
      slot.height = Math.max(slot.height, node.h);
    }
    const ringRadius: number[] = [0];
    for (let l = 1; l <= maxLevel; l += 1) {
      const here = perLevel[l] ?? { count: 1, width: 0, height: 0 };
      const previous = perLevel[l - 1] ?? { count: 1, width: 0, height: 0 };
      const clearPrevious =
        (ringRadius[l - 1] ?? 0) +
        Math.max(previous.height, previous.width) / 2 +
        Math.max(here.height, here.width) / 2 +
        options.spacingY;
      const circumference = (here.count * (here.width + options.spacingX)) / (Math.PI * 2);
      ringRadius.push(Math.max(clearPrevious, circumference));
    }
    const angle = new Map<string, { from: number; to: number }>([
      [root, { from: 0, to: Math.PI * 2 }],
    ]);
    const local = new Map<string, { x: number; y: number }>([[root, { x: 0, y: 0 }]]);
    for (const id of queue) {
      const wedge = angle.get(id) ?? { from: 0, to: Math.PI * 2 };
      const kids = children.get(id) ?? [];
      const total = kids.reduce((sum, kid) => sum + (leaves.get(kid) ?? 1), 0) || 1;
      let from = wedge.from;
      for (const kid of kids) {
        const share = ((leaves.get(kid) ?? 1) / total) * (wedge.to - wedge.from);
        const to = from + share;
        angle.set(kid, { from, to });
        const mid = (from + to) / 2;
        const radius = ringRadius[level.get(kid) ?? 1] ?? 0;
        local.set(kid, { x: Math.cos(mid) * radius, y: Math.sin(mid) * radius });
        from = to;
      }
    }

    const radius = ringRadius[maxLevel] ?? 0;
    for (const id of group) {
      const node = view.nodeById.get(id);
      const point = local.get(id) ?? { x: 0, y: 0 };
      if (node === undefined) continue;
      placements.push(
        placementOf(node, clusterX + point.x - node.w / 2, clusterY + point.y - node.h / 2),
      );
    }

    // Components are packed left to right, wrapping into rows once a row grows wide.
    const span = radius * 2 + options.spacingX * 2;
    clusterX += span + options.spacingX;
    rowHeight = Math.max(rowHeight, radius * 2 + options.spacingY * 2);
    if (clusterX > 8000) {
      clusterX = 0;
      clusterY += rowHeight + options.spacingY;
      rowHeight = 0;
    }
  });

  return placements;
}
