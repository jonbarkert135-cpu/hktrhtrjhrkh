/**
 * The bridge between the engine's `EdgePath` seam and the real router in `@nexus/domain`
 * (07_EDGE_SYSTEM.md §7, §8).
 *
 * The engine stays framework- *and* domain-logic-free: it asks for a polyline and gets one. All
 * the routing, caching and invalidation lives in the domain package, so the same geometry can be
 * produced in a worker (07 §11.2) without dragging the renderer along.
 */

import {
  RouteCache,
  bundledSeparation,
  resolveMode,
  route,
  routeKey,
  withRouteDefaults,
  type EdgeGeometry,
  type NodeBox,
  type ObstacleSource,
  type RouteQuality,
} from '@nexus/domain';

import type { EdgeId, EdgeView, NodeId, NodeView } from '../types';
import type { EdgePath } from './layers';

export interface RoutedEdgePathOptions {
  /** Corner radius of a card, in world units — the design system owns the number. */
  readonly cardRadius?: number;
  /** Current zoom, read per route so short edges degrade to straight (07 §7.2). */
  readonly zoom?: () => number;
  /** `draft` while a drag is in flight; the engine flips it on pointer down/up (07 §8.2). */
  readonly quality?: () => RouteQuality;
  /** Nodes that may obstruct an orthogonal route; omitted means "no obstacle avoidance". */
  readonly obstacles?: ObstacleSource;
  readonly cache?: RouteCache;
  /**
   * Bundling density for parallel runs, 0..1 (07 §7.6, P5 part 4 §4). 0 — the default — keeps the
   * full fan; 1 collapses a dense run onto one line. Read per frame so a slider takes effect live.
   */
  readonly bundleDensity?: () => number;
}

export interface RoutedEdgePath extends EdgePath {
  /** Last geometry computed for an edge — hit-testing and labels read it (07 §10.1, §9). */
  geometry(id: EdgeId): EdgeGeometry | undefined;
  /** Invalidate the edges incident to a node; call it when the node moved (07 §8.2 rule 1). */
  invalidateNode(id: NodeId): number;
  /** Bump after a batch of node moves so orthogonal routes cannot reuse stale geometry. */
  invalidateObstacles(): void;
  readonly cache: RouteCache;
}

export function createRoutedEdgePath(options: RoutedEdgePathOptions = {}): RoutedEdgePath {
  const cache = options.cache ?? new RouteCache();
  const radius = options.cardRadius ?? 0;
  const zoomOf = options.zoom ?? ((): number => 1);
  const qualityOf = options.quality ?? ((): RouteQuality => 'full');
  const latest = new Map<EdgeId, EdgeGeometry>();
  const densityOf = options.bundleDensity ?? ((): number => 0);
  /** Parallel-edge group of each edge, recomputed once per frame from the culled set. */
  const siblings = new Map<EdgeId, { index: number; count: number }>();

  const boxOf = (node: NodeView): NodeBox => ({
    id: node.id,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    radius,
  });

  return {
    cache,

    prepare(edges: readonly EdgeView[]): void {
      siblings.clear();
      const groups = new Map<string, EdgeId[]>();
      for (const edge of edges) {
        // Direction-insensitive key: A→B and B→A share one fan (07 §7.6).
        const key = edge.from < edge.to ? `${edge.from}|${edge.to}` : `${edge.to}|${edge.from}`;
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [edge.id]);
        else group.push(edge.id);
      }
      for (const group of groups.values()) {
        if (group.length === 1) continue;
        for (let i = 0; i < group.length; i += 1) {
          siblings.set(group[i] as EdgeId, { index: i, count: group.length });
        }
      }
    },

    geometry(id: EdgeId): EdgeGeometry | undefined {
      return latest.get(id);
    },

    invalidateNode(id: NodeId): number {
      return cache.invalidateNode(id);
    },

    invalidateObstacles(): void {
      cache.bumpObstacleEpoch();
    },

    route(edge: EdgeView, from: NodeView, to: NodeView, out: number[]): number {
      const source = boxOf(from);
      const target = boxOf(to);
      const quality = qualityOf();
      const group = siblings.get(edge.id) ?? { index: 0, count: 1 };
      const input = withRouteDefaults({
        source,
        target,
        mode: edge.routing,
        siblingIndex: group.index,
        siblingCount: group.count,
        separation: bundledSeparation(group.count, densityOf()),
        waypoints: edge.waypoints ?? [],
        manualRoute: edge.manualRoute ?? false,
        zoom: zoomOf(),
        quality,
        srcPort: toPortRequest(edge.fromAnchor),
        dstPort: toPortRequest(edge.toAnchor),
        ...(options.obstacles === undefined ? {} : { obstacles: options.obstacles }),
      });
      // The *resolved* mode belongs in the key: `smart` and any zoom-degraded edge would otherwise
      // reuse geometry that was routed for a different shape (07 §8.1).
      const key = routeKey({
        edgeId: edge.id,
        version: edge.visualVersion,
        source,
        target,
        resolvedMode: resolveMode(input),
        siblingIndex: input.siblingIndex,
        siblingCount: input.siblingCount,
        separation: input.separation,
        manualRoute: input.manualRoute,
        waypoints: input.waypoints,
        obstacleEpoch: cache.obstacleEpoch,
        quality,
      });

      let geometry = cache.get(key);
      if (geometry === undefined) {
        geometry = route(input);
        cache.set(key, geometry, { id: edge.id, from: edge.from, to: edge.to });
      }
      latest.set(edge.id, geometry);

      const flat = geometry.flat;
      const count = Math.floor(flat.length / 2);
      for (let i = 0; i < count * 2; i += 1) out[i] = flat[i] as number;
      out.length = count * 2;
      return count;
    },
  };
}

function toPortRequest(anchor: EdgeView['fromAnchor']):
  | { side: 'auto'; t: number }
  | {
      side: 'top' | 'right' | 'bottom' | 'left';
      t: number;
    } {
  return anchor.side === 'auto'
    ? { side: 'auto', t: anchor.t }
    : { side: anchor.side, t: anchor.t };
}
