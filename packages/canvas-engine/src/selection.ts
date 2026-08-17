/**
 * Selection as an ordered set (05_CANVAS_ENGINE.md §7.11, roadmap P2 requirement 11).
 *
 * Ordered, not a plain `Set`, because the *last* entry is the alignment anchor: alignment and
 * distribution use it as the immovable reference. Re-selecting an id moves it to the end, so the
 * anchor is always "the thing the user touched last".
 */

import type { EntityId, Rect, SceneQuery, SelectionController, SelectionMode } from './types';

/** Notified after every change that actually altered the ordered set. */
export type SelectionListener = (ids: readonly EntityId[]) => void;

const unionBounds = (a: Rect, n: { x: number; y: number; w: number; h: number }): Rect => {
  const x = Math.min(a.x, n.x);
  const y = Math.min(a.y, n.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, n.x + n.w) - x,
    h: Math.max(a.y + a.h, n.y + n.h) - y,
  };
};

const sameOrder = (a: readonly EntityId[], b: readonly EntityId[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * `query` supplies the scene: `selectAll` and `bounds` are the only places selection needs to know
 * anything about geometry, so nothing heavier than the read-only query seam is injected.
 */
export function createSelection(
  query: SceneQuery,
  onChange?: SelectionListener,
): SelectionController {
  let ids: EntityId[] = [];

  const commit = (next: EntityId[]): void => {
    if (sameOrder(ids, next)) return;
    ids = next;
    onChange?.(ids);
  };

  const apply = (incoming: readonly EntityId[], mode: SelectionMode): EntityId[] => {
    if (mode === 'replace') return [...new Set(incoming)];
    if (mode === 'subtract') {
      const drop = new Set(incoming);
      return ids.filter((id) => !drop.has(id));
    }
    const next = [...ids];
    for (const id of incoming) {
      const at = next.indexOf(id);
      if (at === -1) {
        next.push(id); // add, and for toggle: not present → select
      } else if (mode === 'toggle') {
        next.splice(at, 1);
      } else {
        // `add` on an already-selected id re-anchors it: the user just clicked it.
        next.splice(at, 1);
        next.push(id);
      }
    }
    return next;
  };

  return {
    get ids(): readonly EntityId[] {
      return ids;
    },
    get anchor(): EntityId | null {
      return ids.length === 0 ? null : (ids[ids.length - 1] ?? null);
    },
    has(id: EntityId): boolean {
      return ids.includes(id);
    },
    set(incoming: readonly EntityId[], mode: SelectionMode = 'replace'): void {
      commit(apply(incoming, mode));
    },
    clear(): void {
      commit([]);
    },
    selectAll(): void {
      commit(query.nodesIn(query.sceneBounds).map((n) => n.id));
    },
    bounds(): Rect | null {
      let box: Rect | null = null;
      for (const id of ids) {
        const node = query.node(id);
        if (node === undefined) continue; // edges and groups contribute no geometry here
        box =
          box === null ? { x: node.x, y: node.y, w: node.w, h: node.h } : unionBounds(box, node);
      }
      return box;
    },
  };
}
