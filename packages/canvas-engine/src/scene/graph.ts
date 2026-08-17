/**
 * Scene graph (05_CANVAS_ENGINE.md §6.1) and the query surface over it (§6.5, `SceneQuery` in
 * `../types`).
 *
 * Flat by design: groups are membership metadata, never a transform tree. Every derived structure
 * (`byLayer`, `edgesByNode`, `groupChildren`, `sceneBounds`, the spatial index) is maintained
 * incrementally by `applyPatch`, in O(entities the patch touches).
 *
 * The graph never mutates the `NodeView`/`EdgeView` objects it is handed: moves and resizes write a
 * shallow copy, so the host may keep its own references.
 */

import type {
  EdgeId,
  EdgeView,
  GroupId,
  GroupView,
  LayerId,
  LayerView,
  NodeId,
  NodeView,
  Rect,
  SceneQuery,
  SceneSnapshot,
  ScenePatch,
  Vec2,
} from '../types';
import {
  createGridIndex,
  rectContainsPoint,
  rectContainsRect,
  type GridIndexOptions,
  type SpatialIndex,
} from './index-grid';

export interface SceneDirty {
  nodes: Set<NodeId>;
  edges: Set<EdgeId>;
  /** World rects that must be repainted (the before and after rect of every change). */
  rects: Rect[];
  /** Set when a patch invalidates the whole frame (layer changes). */
  full: boolean;
}

export interface SceneGraph {
  readonly nodes: ReadonlyMap<NodeId, NodeView>;
  readonly edges: ReadonlyMap<EdgeId, EdgeView>;
  readonly groups: ReadonlyMap<GroupId, GroupView>;
  readonly layers: readonly LayerView[];
  /** Render order per layer, bottom→top by fractional z (ties broken by id for determinism). */
  readonly byLayer: ReadonlyMap<LayerId, readonly NodeId[]>;
  readonly edgesByNode: ReadonlyMap<NodeId, ReadonlySet<EdgeId>>;
  readonly groupChildren: ReadonlyMap<GroupId, ReadonlySet<NodeId>>;
  /** Union of the group's member bounds, recomputed only when a member changed. */
  groupBounds(id: GroupId): Rect | null;
  readonly dirty: SceneDirty;
  clearDirty(): void;
  /** Applies one patch; `bulk` is atomic — it validates every sub-patch before touching state. */
  applyPatch(patch: ScenePatch): void;
  readonly query: SceneQuery;
  readonly index: SpatialIndex;
}

export type SceneGraphOptions = GridIndexOptions;

const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

function nodeRect(n: NodeView): Rect {
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

/** Throws on structurally invalid input; called for the whole tree before a `bulk` mutates. */
function assertValid(patch: ScenePatch): void {
  switch (patch.op) {
    case 'upsert-node': {
      const n = patch.node;
      if (n.id === '') throw new RangeError('upsert-node: empty id');
      if (!finite(n.x, n.y, n.w, n.h, n.z)) throw new RangeError(`upsert-node ${n.id}: non-finite`);
      return;
    }
    case 'move-nodes': {
      for (const m of patch.moves) {
        if (!finite(m.x, m.y)) throw new RangeError(`move-nodes ${m.id}: non-finite`);
      }
      return;
    }
    case 'resize-node': {
      if (!finite(patch.w, patch.h)) throw new RangeError(`resize-node ${patch.id}: non-finite`);
      if (patch.x !== undefined && !Number.isFinite(patch.x)) {
        throw new RangeError(`resize-node ${patch.id}: non-finite x`);
      }
      if (patch.y !== undefined && !Number.isFinite(patch.y)) {
        throw new RangeError(`resize-node ${patch.id}: non-finite y`);
      }
      return;
    }
    case 'upsert-edge': {
      const e = patch.edge;
      if (e.id === '') throw new RangeError('upsert-edge: empty id');
      if (!finite(e.z)) throw new RangeError(`upsert-edge ${e.id}: non-finite z`);
      return;
    }
    case 'set-layers': {
      const ids = new Set(patch.layers.map((l) => l.id));
      if (ids.size !== patch.layers.length) throw new RangeError('set-layers: duplicate layer id');
      return;
    }
    case 'bulk': {
      for (const p of patch.patches) assertValid(p);
      return;
    }
    case 'remove-node':
    case 'remove-edge':
    case 'upsert-group':
    case 'remove-group':
      return;
  }
}

export function createSceneGraph(
  snapshot: SceneSnapshot,
  options: SceneGraphOptions = {},
): SceneGraph {
  const nodes = new Map<NodeId, NodeView>();
  const edges = new Map<EdgeId, EdgeView>();
  const groups = new Map<GroupId, GroupView>();
  let layers: LayerView[] = [];
  let layerRank = new Map<LayerId, number>();
  const byLayer = new Map<LayerId, NodeId[]>();
  const edgesByNode = new Map<NodeId, Set<EdgeId>>();
  const groupChildren = new Map<GroupId, Set<NodeId>>();
  const groupBoundsCache = new Map<GroupId, Rect>();
  const groupBoundsStale = new Set<GroupId>();
  const index = createGridIndex(options);
  const dirty: SceneDirty = { nodes: new Set(), edges: new Set(), rects: [], full: false };

  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let boundsCount = 0;

  /** Hidden nodes and nodes on an invisible layer are out of the index and out of every query. */
  const isVisible = (n: NodeView): boolean => {
    if (n.hidden) return false;
    const rank = layerRank.get(n.layerId);
    if (rank === undefined) return true; // unknown layer: no layer restriction to apply
    return layers[rank]?.visible !== false;
  };

  const setLayerRank = (next: LayerView[]): void => {
    layers = next;
    layerRank = new Map(next.map((l, i) => [l.id, i]));
  };

  const rankOf = (n: NodeView): number => layerRank.get(n.layerId) ?? layers.length;

  /** bottom→top: layer order, then fractional z, then id. */
  const compareNodes = (a: NodeView, b: NodeView): number =>
    rankOf(a) - rankOf(b) || a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const layerList = (id: LayerId): NodeId[] => {
    const existing = byLayer.get(id);
    if (existing) return existing;
    const created: NodeId[] = [];
    byLayer.set(id, created);
    return created;
  };

  const layerInsert = (n: NodeView): void => {
    const list = layerList(n.layerId);
    // Binary search on z keeps insertion O(log n) comparisons + one array splice.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const id = list[mid];
      const other = id === undefined ? undefined : nodes.get(id);
      if (other !== undefined && compareNodes(other, n) < 0) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, n.id);
  };

  const layerRemove = (n: NodeView): void => {
    const list = byLayer.get(n.layerId);
    if (!list) return;
    const at = list.indexOf(n.id);
    if (at >= 0) list.splice(at, 1);
    if (list.length === 0) byLayer.delete(n.layerId);
  };

  const growBounds = (r: Rect): void => {
    if (boundsCount === 0) {
      minX = r.x;
      minY = r.y;
      maxX = r.x + r.w;
      maxY = r.y + r.h;
    } else {
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
    }
    boundsCount += 1;
  };

  const recomputeBounds = (): void => {
    boundsCount = 0;
    for (const n of nodes.values()) {
      if (isVisible(n)) growBounds(nodeRect(n));
    }
    if (boundsCount === 0) {
      minX = 0;
      minY = 0;
      maxX = 0;
      maxY = 0;
    }
  };

  const touchesExtreme = (r: Rect): boolean =>
    r.x === minX || r.y === minY || r.x + r.w === maxX || r.y + r.h === maxY;

  /** Amortised O(1): only a node that touched an extreme forces the O(n) recompute (§6.1). */
  const shrinkBounds = (r: Rect): void => {
    boundsCount -= 1;
    if (boundsCount === 0) {
      minX = 0;
      minY = 0;
      maxX = 0;
      maxY = 0;
      return;
    }
    if (touchesExtreme(r)) recomputeBounds();
  };

  const touchGroup = (id: GroupId | null): void => {
    if (id !== null) groupBoundsStale.add(id);
  };

  const markNode = (n: NodeView): void => {
    dirty.nodes.add(n.id);
    dirty.rects.push(nodeRect(n));
    touchGroup(n.groupId);
    const incident = edgesByNode.get(n.id);
    if (incident) for (const e of incident) dirty.edges.add(e);
  };

  const linkEdge = (e: EdgeView): void => {
    for (const nodeId of [e.from, e.to]) {
      const set = edgesByNode.get(nodeId);
      if (set) set.add(e.id);
      else edgesByNode.set(nodeId, new Set([e.id]));
    }
  };

  const unlinkEdge = (e: EdgeView): void => {
    for (const nodeId of [e.from, e.to]) {
      const set = edgesByNode.get(nodeId);
      if (!set) continue;
      set.delete(e.id);
      if (set.size === 0) edgesByNode.delete(nodeId);
    }
  };

  const addNode = (n: NodeView): void => {
    nodes.set(n.id, n);
    layerInsert(n);
    if (n.groupId !== null) {
      const set = groupChildren.get(n.groupId);
      if (set) set.add(n.id);
      else groupChildren.set(n.groupId, new Set([n.id]));
      groupBoundsStale.add(n.groupId);
    }
    if (isVisible(n)) {
      index.insert(n.id, nodeRect(n));
      growBounds(nodeRect(n));
    }
    markNode(n);
  };

  const dropNode = (n: NodeView): void => {
    nodes.delete(n.id);
    layerRemove(n);
    if (n.groupId !== null) {
      const set = groupChildren.get(n.groupId);
      if (set) {
        set.delete(n.id);
        if (set.size === 0) groupChildren.delete(n.groupId);
      }
      groupBoundsStale.add(n.groupId);
    }
    if (isVisible(n)) {
      index.remove(n.id);
      shrinkBounds(nodeRect(n));
    }
    markNode(n);
  };

  const removeEdge = (id: EdgeId): void => {
    const existing = edges.get(id);
    if (!existing) return;
    unlinkEdge(existing);
    edges.delete(id);
    dirty.edges.add(id);
  };

  const removeNode = (id: NodeId): void => {
    const existing = nodes.get(id);
    if (!existing) return;
    const incident = edgesByNode.get(id);
    if (incident) for (const edgeId of [...incident]) removeEdge(edgeId);
    dropNode(existing);
  };

  /** Move/resize share this path: replace the view, reindex, keep bounds and dirty sets honest. */
  const replaceGeometry = (prev: NodeView, next: NodeView): void => {
    markNode(prev);
    const wasVisible = isVisible(prev);
    nodes.set(next.id, next);
    const nowVisible = isVisible(next);
    if (nowVisible) index.update(next.id, nodeRect(next));
    else index.remove(next.id);
    if (wasVisible && touchesExtreme(nodeRect(prev))) {
      // `nodes` already holds `next`, so the full pass produces the final bounds and count.
      recomputeBounds();
    } else {
      if (wasVisible) boundsCount -= 1;
      if (nowVisible) growBounds(nodeRect(next));
    }
    markNode(next);
  };

  const reindexVisibility = (): void => {
    for (const n of nodes.values()) {
      if (isVisible(n)) index.insert(n.id, nodeRect(n));
      else index.remove(n.id);
    }
    recomputeBounds();
    for (const id of groupChildren.keys()) groupBoundsStale.add(id);
    dirty.full = true;
  };

  const apply = (patch: ScenePatch): void => {
    switch (patch.op) {
      case 'upsert-node': {
        const existing = nodes.get(patch.node.id);
        if (existing) dropNode(existing);
        addNode(patch.node);
        return;
      }
      case 'remove-node':
        removeNode(patch.id);
        return;
      case 'move-nodes': {
        for (const m of patch.moves) {
          const prev = nodes.get(m.id);
          if (!prev || (prev.x === m.x && prev.y === m.y)) continue;
          replaceGeometry(prev, { ...prev, x: m.x, y: m.y });
        }
        return;
      }
      case 'resize-node': {
        const prev = nodes.get(patch.id);
        if (!prev) return;
        replaceGeometry(prev, {
          ...prev,
          w: patch.w,
          h: patch.h,
          x: patch.x ?? prev.x,
          y: patch.y ?? prev.y,
        });
        return;
      }
      case 'upsert-edge': {
        const existing = edges.get(patch.edge.id);
        if (existing) unlinkEdge(existing);
        edges.set(patch.edge.id, patch.edge);
        linkEdge(patch.edge);
        dirty.edges.add(patch.edge.id);
        return;
      }
      case 'remove-edge':
        removeEdge(patch.id);
        return;
      case 'upsert-group': {
        groups.set(patch.group.id, patch.group);
        groupBoundsStale.add(patch.group.id);
        dirty.full = true;
        return;
      }
      case 'remove-group': {
        if (!groups.delete(patch.id)) return;
        const children = groupChildren.get(patch.id);
        if (children) {
          for (const nodeId of [...children]) {
            const n = nodes.get(nodeId);
            if (n) nodes.set(nodeId, { ...n, groupId: null });
            dirty.nodes.add(nodeId);
          }
          groupChildren.delete(patch.id);
        }
        groupBoundsCache.delete(patch.id);
        groupBoundsStale.delete(patch.id);
        return;
      }
      case 'set-layers': {
        setLayerRank([...patch.layers]);
        // Layer order changes the render order of every list, so the lists are re-sorted whole.
        for (const list of byLayer.values()) {
          list.sort((a, b) => {
            const na = nodes.get(a);
            const nb = nodes.get(b);
            return na && nb ? compareNodes(na, nb) : 0;
          });
        }
        reindexVisibility();
        return;
      }
      case 'bulk': {
        for (const p of patch.patches) apply(p);
        return;
      }
    }
  };

  const visibleNodes = (ids: readonly NodeId[]): NodeView[] => {
    const out: NodeView[] = [];
    for (const id of ids) {
      const n = nodes.get(id);
      if (n && isVisible(n)) out.push(n);
    }
    return out;
  };

  const query: SceneQuery = {
    nodesIn(rect: Rect): NodeView[] {
      return visibleNodes(index.queryRect(rect)).sort(compareNodes);
    },
    nodesContainedIn(rect: Rect): NodeView[] {
      return visibleNodes(index.queryRect(rect))
        .filter((n) => rectContainsRect(rect, nodeRect(n)))
        .sort(compareNodes);
    },
    nodeAt(p: Vec2): NodeView | null {
      let best: NodeView | null = null;
      for (const id of index.queryPoint(p)) {
        const n = nodes.get(id);
        // Locked nodes stay hit-testable so they can be selected and unlocked (05 §7.7).
        if (!n || !isVisible(n) || !rectContainsPoint(nodeRect(n), p)) continue;
        if (best === null || compareNodes(best, n) < 0) best = n;
      }
      return best;
    },
    node(id: NodeId): NodeView | undefined {
      return nodes.get(id);
    },
    edge(id: EdgeId): EdgeView | undefined {
      return edges.get(id);
    },
    get sceneBounds(): Rect {
      if (boundsCount === 0) return { ...EMPTY_RECT };
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    },
    get nodeCount(): number {
      return nodes.size;
    },
  };

  setLayerRank([...snapshot.layers]);
  for (const n of snapshot.nodes) addNode(n);
  for (const e of snapshot.edges) {
    edges.set(e.id, e);
    linkEdge(e);
  }
  for (const g of snapshot.groups) groups.set(g.id, g);
  dirty.full = true;

  return {
    nodes,
    edges,
    groups,
    get layers(): readonly LayerView[] {
      return layers;
    },
    byLayer,
    edgesByNode,
    groupChildren,
    groupBounds(id: GroupId): Rect | null {
      if (!groupBoundsStale.has(id)) {
        const cached = groupBoundsCache.get(id);
        if (cached) return { ...cached };
      }
      groupBoundsStale.delete(id);
      const children = groupChildren.get(id);
      if (!children || children.size === 0) {
        groupBoundsCache.delete(id);
        return null;
      }
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const nodeId of children) {
        const n = nodes.get(nodeId);
        if (!n) continue;
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + n.w);
        y1 = Math.max(y1, n.y + n.h);
      }
      if (x0 === Infinity) {
        groupBoundsCache.delete(id);
        return null;
      }
      const rect: Rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      groupBoundsCache.set(id, rect);
      return { ...rect };
    },
    dirty,
    clearDirty(): void {
      dirty.nodes.clear();
      dirty.edges.clear();
      dirty.rects.length = 0;
      dirty.full = false;
    },
    applyPatch(patch: ScenePatch): void {
      assertValid(patch);
      apply(patch);
    },
    query,
    index,
  };
}
