/**
 * Tidy-tree layout (Reingold–Tilford, first-pass form): leaves are packed in order, every parent
 * is centred over its children, and sibling subtrees never overlap because each subtree reserves
 * its own extent. Cycles and cross-links are handled by laying out a spanning forest.
 */

import { acyclic, spanningForest } from '../graph.ts';
import type { Placement } from '../overlap.ts';
import { checkpoint, isVertical, placementOf, type AlgorithmInput } from './shared.ts';

export function tree(input: AlgorithmInput): Placement[] {
  const { view, options, ctx } = input;
  const dag = acyclic(view);
  const forest = spanningForest(view, dag.out, dag.in);
  checkpoint(ctx, 0.2);

  const vertical = isVertical(options.direction);
  const reversed = options.direction === 'up' || options.direction === 'left';
  const primaryOf = (id: string): number => {
    const node = view.nodeById.get(id);
    return node === undefined ? 0 : vertical ? node.w : node.h;
  };
  const crossOf = (id: string): number => {
    const node = view.nodeById.get(id);
    return node === undefined ? 0 : vertical ? node.h : node.w;
  };

  const primary = new Map<string, number>();
  const depth = new Map<string, number>();
  let cursor = 0;

  // Iterative post-order walk: a 5,000-node chain must not recurse.
  for (const root of forest.roots) {
    const stack: Array<{ id: string; index: number; depth: number }> = [
      { id: root, index: 0, depth: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { id: string; index: number; depth: number };
      const children = forest.children.get(frame.id) ?? [];
      if (frame.index === 0) depth.set(frame.id, frame.depth);
      if (frame.index < children.length) {
        const child = children[frame.index] as string;
        frame.index += 1;
        stack.push({ id: child, index: 0, depth: frame.depth + 1 });
        continue;
      }
      if (children.length === 0) {
        primary.set(frame.id, cursor);
        cursor += primaryOf(frame.id) + options.spacingX;
      } else {
        const first = primary.get(children[0] as string) ?? 0;
        const lastId = children[children.length - 1] as string;
        const last = (primary.get(lastId) ?? 0) + primaryOf(lastId);
        primary.set(frame.id, (first + last) / 2 - primaryOf(frame.id) / 2);
      }
      stack.pop();
    }
    // Roots of the forest are separated by a full cluster gap, not by a sibling gap.
    cursor += options.spacingY;
    checkpoint(ctx, 0.2 + 0.6 * (forest.roots.indexOf(root) / Math.max(1, forest.roots.length)));
  }

  // Cross positions: one row per depth, tall enough for the tallest node in that row.
  const maxDepth = Math.max(0, ...view.ids.map((id) => depth.get(id) ?? 0));
  const rowSize: number[] = Array.from({ length: maxDepth + 1 }, () => 0);
  for (const id of view.ids) {
    const level = depth.get(id) ?? 0;
    rowSize[level] = Math.max(rowSize[level] ?? 0, crossOf(id));
  }
  const rowStart: number[] = [];
  let offset = 0;
  for (let level = 0; level <= maxDepth; level += 1) {
    rowStart.push(offset);
    offset += (rowSize[level] ?? 0) + options.spacingY;
  }

  return view.ids.map((id) => {
    const node = view.nodeById.get(id);
    const level = depth.get(id) ?? 0;
    const along = primary.get(id) ?? 0;
    const across = reversed ? -(rowStart[level] ?? 0) - crossOf(id) : (rowStart[level] ?? 0);
    if (node === undefined) return { id, x: along, y: across, w: 0, h: 0, pinned: false };
    return vertical ? placementOf(node, along, across) : placementOf(node, across, along);
  });
}
