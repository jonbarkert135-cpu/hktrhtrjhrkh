/**
 * Layered (Sugiyama-style) layout: cycle removal → longest-path layering → barycentre ordering →
 * coordinate assignment. The classic answer to "who reports to whom / what came from what", and
 * the default for a board that has a direction of causality.
 */

import { acyclic, rankNodes } from '../graph.ts';
import type { Placement } from '../overlap.ts';
import { checkpoint, orderByBarycentre, placeRanks, type AlgorithmInput } from './shared.ts';

export function hierarchical(input: AlgorithmInput): Placement[] {
  const { view, options, ctx } = input;
  checkpoint(ctx, 0.05);
  const dag = acyclic(view);
  const rank = rankNodes(view.ids, dag.out, dag.in);
  checkpoint(ctx, 0.2);

  const depth = Math.max(0, ...view.ids.map((id) => rank.get(id) ?? 0));
  const ranks: string[][] = Array.from({ length: depth + 1 }, () => []);
  for (const id of view.ids) (ranks[rank.get(id) ?? 0] as string[]).push(id);

  const ordered = orderByBarycentre(ranks, view, ctx, 0.2);
  checkpoint(ctx, 0.75);
  return placeRanks(ordered, view, options);
}
