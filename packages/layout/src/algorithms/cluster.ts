/**
 * Cluster layout: group by `node.group` when the host supplied one, otherwise by connected
 * component. Each cluster is packed into a grid block sized to its own contents, and the blocks
 * are laid out in a row-major grid ordered by size (largest first), so the shape of the
 * investigation — three big clusters and a dozen strays — is the first thing you see.
 */

import { components } from '../graph.ts';
import type { Placement } from '../overlap.ts';
import { checkpoint, placementOf, type AlgorithmInput } from './shared.ts';

export function cluster(input: AlgorithmInput): Placement[] {
  const { view, options, ctx } = input;
  checkpoint(ctx, 0.05);

  const hasGroups = view.ids.some((id) => {
    const group = view.nodeById.get(id)?.group;
    return group !== null && group !== undefined && group !== '';
  });

  let groups: string[][];
  if (hasGroups) {
    const byKey = new Map<string, string[]>();
    const order: string[] = [];
    for (const id of view.ids) {
      const key = view.nodeById.get(id)?.group ?? '';
      const bucket = byKey.get(key);
      if (bucket === undefined) {
        byKey.set(key, [id]);
        order.push(key);
      } else bucket.push(id);
    }
    groups = order.map((key) => byKey.get(key) ?? []);
  } else {
    groups = components(view);
  }

  // Largest first, ties on the first member's input order: deterministic and readable.
  const positionOf = new Map(view.ids.map((id, index) => [id, index] as const));
  const ordered = [...groups].sort(
    (a, b) =>
      b.length - a.length || (positionOf.get(a[0] ?? '') ?? 0) - (positionOf.get(b[0] ?? '') ?? 0),
  );

  const placements: Placement[] = [];
  const blocks: Array<{ w: number; h: number; items: Placement[] }> = [];
  ordered.forEach((group, index) => {
    checkpoint(ctx, 0.05 + (index / Math.max(1, ordered.length)) * 0.8);
    const columns = Math.max(1, Math.ceil(Math.sqrt(group.length)));
    const items: Placement[] = [];
    let rowTop = 0;
    let rowHeight = 0;
    let x = 0;
    let width = 0;
    group.forEach((id, position) => {
      const node = view.nodeById.get(id);
      if (node === undefined) return;
      if (position % columns === 0 && position > 0) {
        rowTop += rowHeight + options.spacingY;
        rowHeight = 0;
        x = 0;
      }
      items.push(placementOf(node, x, rowTop));
      x += node.w + options.spacingX;
      width = Math.max(width, x - options.spacingX);
      rowHeight = Math.max(rowHeight, node.h);
    });
    blocks.push({ w: width, h: rowTop + rowHeight, items });
  });

  const gap = options.spacingX * 3;
  const perRow = Math.max(1, Math.ceil(Math.sqrt(blocks.length)));
  let blockX = 0;
  let blockY = 0;
  let tallest = 0;
  blocks.forEach((block, index) => {
    if (index % perRow === 0 && index > 0) {
      blockX = 0;
      blockY += tallest + gap;
      tallest = 0;
    }
    for (const item of block.items) {
      item.x += blockX;
      item.y += blockY;
      placements.push(item);
    }
    blockX += block.w + gap;
    tallest = Math.max(tallest, block.h);
  });

  return placements;
}
