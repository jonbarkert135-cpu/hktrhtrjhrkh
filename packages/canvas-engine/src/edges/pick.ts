/**
 * Edge picking: which edge is under the pointer (20_ROADMAP P5 §5.10, 07_EDGE_SYSTEM.md §10.1).
 *
 * Like `routed-edge-path.ts` this is a *bridge* module: the geometry and the distance maths live in
 * `@nexus/domain`, the engine only asks "which id, if any". Keeping it out of `engine.ts` is what
 * lets the engine core stay free of domain imports — the host injects the picker as an option.
 */

import { pickEdge, type EdgeGeometry } from '@nexus/domain';

import type { EdgeId, EdgeView, Vec2 } from '../types';

/** The subset of `RoutedEdgePath` a picker needs: the geometry actually painted last frame. */
export interface GeometrySource {
  geometry(id: EdgeId): EdgeGeometry | undefined;
}

export type EdgePicker = (
  world: Vec2,
  tolerance: number,
  edges: readonly EdgeView[],
) => EdgeId | null;

export interface EdgePickerOptions {
  readonly source: GeometrySource;
  /** Selected edges win ties, so clicking a bundle keeps the edge the analyst already has. */
  readonly isSelected?: (id: EdgeId) => boolean;
}

/**
 * Picks the nearest edge whose *last painted* geometry passes within `tolerance` world units.
 * Edges that were never painted (offscreen, hidden) have no geometry and are skipped, which is the
 * cheap culling the picker needs: no scene-wide scan.
 */
export function createEdgePicker(options: EdgePickerOptions): EdgePicker {
  const { source } = options;
  const isSelected = options.isSelected;

  return (world: Vec2, tolerance: number, edges: readonly EdgeView[]): EdgeId | null => {
    const candidates: Array<{ id: string; geometry: EdgeGeometry; priority: number }> = [];
    for (const edge of edges) {
      if (edge.hidden) continue;
      const geometry = source.geometry(edge.id);
      if (geometry === undefined) continue;
      candidates.push({
        id: edge.id,
        geometry,
        priority: isSelected?.(edge.id) === true ? 1 : 0,
      });
    }
    if (candidates.length === 0) return null;
    const hit = pickEdge(candidates, world, tolerance);
    return hit === null ? null : hit.id;
  };
}
