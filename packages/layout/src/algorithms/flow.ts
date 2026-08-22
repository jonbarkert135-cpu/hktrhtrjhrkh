/**
 * Flow layout: like `hierarchical`, but ranks by distance from a source rather than by longest
 * path, and lays each connected component out in its own band. That is the shape an analyst wants
 * for "this led to this led to this" chains, where an unrelated second chain must not be dragged
 * down to the depth of the first.
 */

import { acyclic, components } from '../graph.ts';
import type { Placement } from '../overlap.ts';
import {
  checkpoint,
  isVertical,
  orderByBarycentre,
  placeRanks,
  type AlgorithmInput,
} from './shared.ts';

export function flow(input: AlgorithmInput): Placement[] {
  const { view, options, ctx } = input;
  const resolved = {
    ...options,
    direction: options.direction === 'down' ? 'right' : options.direction,
  };
  const dag = acyclic(view);
  checkpoint(ctx, 0.1);

  const placements: Placement[] = [];
  const groups = components(view);
  let bandOffset = 0;
  groups.forEach((group, index) => {
    checkpoint(ctx, 0.1 + (index / Math.max(1, groups.length)) * 0.8);
    const member = new Set(group);
    const depth = new Map<string, number>();
    const queue: string[] = [];
    for (const id of group)
      if ((dag.in.get(id) ?? []).filter((from) => member.has(from)).length === 0) {
        depth.set(id, 0);
        queue.push(id);
      }
    if (queue.length === 0 && group.length > 0) {
      depth.set(group[0] as string, 0);
      queue.push(group[0] as string);
    }
    let cursor = 0;
    while (cursor < queue.length) {
      const id = queue[cursor] as string;
      cursor += 1;
      for (const next of dag.out.get(id) ?? []) {
        if (!member.has(next) || depth.has(next)) continue;
        depth.set(next, (depth.get(id) ?? 0) + 1);
        queue.push(next);
      }
    }
    for (const id of group) if (!depth.has(id)) depth.set(id, 0);

    const maxDepth = Math.max(0, ...group.map((id) => depth.get(id) ?? 0));
    const ranks: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
    for (const id of group) (ranks[depth.get(id) ?? 0] as string[]).push(id);
    const ordered = orderByBarycentre(ranks, view, ctx, 0.1);

    const band = placeRanks(ordered, view, resolved);
    const vertical = isVertical(resolved.direction);
    let extent = 0;
    for (const p of band) extent = Math.max(extent, vertical ? p.x + p.w : p.y + p.h);
    for (const p of band) {
      if (vertical) p.x += bandOffset;
      else p.y += bandOffset;
      placements.push(p);
    }
    bandOffset += extent + options.spacingY * 2;
  });

  return placements;
}
