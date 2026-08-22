/**
 * Timeline layout: chronology by `observed_at` (`03_UX.md` §16), falling back to the node's own
 * order for undated nodes, which are parked in a clearly separated "undated" lane rather than
 * pretending to have a date.
 *
 * Lanes come from `node.group` (the host passes the group id, tag or type it wants to lane by).
 */

import type { Placement } from '../overlap.ts';
import { checkpoint, placementOf, type AlgorithmInput } from './shared.ts';

const UNDATED = Symbol('undated');

function instantOf(value: string | null | undefined): number | typeof UNDATED {
  if (value === null || value === undefined || value === '') return UNDATED;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? UNDATED : ms;
}

export function timeline(input: AlgorithmInput): Placement[] {
  const { graph, view, options, ctx } = input;
  checkpoint(ctx, 0.1);

  const dated: Array<{ id: string; at: number }> = [];
  const undated: string[] = [];
  for (const node of graph.nodes) {
    const at = instantOf(node.observedAt);
    if (at === UNDATED) undated.push(node.id);
    else dated.push({ id: node.id, at });
  }
  // Ties break on id so two events recorded in the same second never swap between runs.
  dated.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const lanes: string[] = [];
  const laneOf = (id: string): number => {
    const key = view.nodeById.get(id)?.group ?? '';
    const found = lanes.indexOf(key);
    if (found >= 0) return found;
    lanes.push(key);
    return lanes.length - 1;
  };

  let laneHeight = 0;
  for (const node of graph.nodes) laneHeight = Math.max(laneHeight, node.h);
  const laneStep = laneHeight + options.spacingY;

  const placements: Placement[] = [];
  let cursor = 0;
  dated.forEach((entry, index) => {
    if (index % 256 === 0) checkpoint(ctx, 0.1 + (index / Math.max(1, dated.length)) * 0.7);
    const node = view.nodeById.get(entry.id);
    if (node === undefined) return;
    placements.push(placementOf(node, cursor, laneOf(entry.id) * laneStep));
    cursor += node.w + options.spacingX;
  });

  // The undated lane sits below every dated lane, separated by a full cluster gap: "no date yet"
  // must never be readable as "happened last".
  const undatedTop = Math.max(1, lanes.length) * laneStep + options.spacingY * 2;
  let undatedCursor = 0;
  for (const id of undated) {
    const node = view.nodeById.get(id);
    if (node === undefined) continue;
    placements.push(placementOf(node, undatedCursor, undatedTop));
    undatedCursor += node.w + options.spacingX;
  }

  checkpoint(ctx, 0.9);
  return placements;
}
