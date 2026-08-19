/**
 * Route caching and invalidation (07_EDGE_SYSTEM.md §8.1, §8.2).
 *
 * The cache key is the *only* thing that decides whether geometry is reused, so it has to contain
 * every input the router reads. Node geometry enters it quantized to one canvas unit: during a
 * drag the sub-pixel jitter of a pointer must not invalidate the whole board.
 */

import type { RoutingMode } from '../types.ts';
import type { NodeBox, RouteInput, Waypoint } from './types.ts';
import type { EdgeGeometry } from './types.ts';

/** Quantization step of node geometry inside the key (07 §8.1). */
export const GEOM_QUANTUM = 1;

export function quantize(value: number, step: number = GEOM_QUANTUM): number {
  return Math.round(value / step);
}

/** A stable, collision-resistant hash of a node's box. */
export function nodeGeomHash(box: NodeBox): string {
  return `${quantize(box.x)},${quantize(box.y)},${quantize(box.w)},${quantize(box.h)}`;
}

export function waypointsHash(waypoints: readonly Waypoint[]): string {
  return waypoints.map((w) => `${quantize(w.x)}/${quantize(w.y)}`).join(';');
}

export interface RouteKeyInput {
  readonly edgeId: string;
  readonly version: number;
  readonly source: NodeBox;
  readonly target: NodeBox;
  readonly resolvedMode: RoutingMode;
  readonly siblingIndex: number;
  readonly siblingCount: number;
  readonly manualRoute: boolean;
  readonly waypoints: readonly Waypoint[];
  /** Board-level counter, bumped whenever any node geometry changes (07 §8.1). */
  readonly obstacleEpoch: number;
  readonly quality: RouteInput['quality'];
  /** Parallel spacing; a bundling density change reshapes the fan (07 §7.6). */
  readonly separation?: number;
}

export function routeKey(input: RouteKeyInput): string {
  // Waypoints shape every mode now (P5 part 4 §1), so they are always part of the key; the
  // obstacle epoch only matters when the router is allowed to reshape around cards.
  const tail = input.manualRoute
    ? `w:${waypointsHash(input.waypoints)}`
    : `w:${waypointsHash(input.waypoints)}:e:${input.obstacleEpoch}`;
  return [
    input.edgeId,
    input.version,
    nodeGeomHash(input.source),
    nodeGeomHash(input.target),
    input.resolvedMode,
    `${input.siblingIndex}/${input.siblingCount}`,
    quantize(input.separation ?? 0),
    input.quality,
    tail,
  ].join(':');
}

/**
 * A bounded LRU over routed geometry. `Map` preserves insertion order, so "least recently used" is
 * simply the first key — no auxiliary list, no pointer chasing.
 */
export class RouteCache {
  private readonly entries = new Map<string, EdgeGeometry>();
  /** Adjacency kept in sync by the host: which edges touch a node (07 §8.2 rule 1). */
  private readonly byNode = new Map<string, Set<string>>();
  private readonly keyByEdge = new Map<string, string>();
  private epoch = 0;
  private hitCount = 0;
  private missCount = 0;

  // Plain field + assignment, not a parameter property: the api image runs the TypeScript sources
  // through `node --experimental-strip-types`, which cannot erase parameter properties.
  readonly capacity: number;

  constructor(capacity = 4096) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.entries.size;
  }

  get stats(): { hits: number; misses: number; size: number; epoch: number } {
    return {
      hits: this.hitCount,
      misses: this.missCount,
      size: this.entries.size,
      epoch: this.epoch,
    };
  }

  /** The current obstacle epoch, to be embedded in the next key. */
  get obstacleEpoch(): number {
    return this.epoch;
  }

  get(key: string): EdgeGeometry | undefined {
    const found = this.entries.get(key);
    if (found === undefined) {
      this.missCount += 1;
      return undefined;
    }
    // Re-insert so the entry becomes the most recently used one.
    this.entries.delete(key);
    this.entries.set(key, found);
    this.hitCount += 1;
    return found;
  }

  set(key: string, geometry: EdgeGeometry, edge: { id: string; from: string; to: string }): void {
    const previousKey = this.keyByEdge.get(edge.id);
    if (previousKey !== undefined && previousKey !== key) this.entries.delete(previousKey);
    this.entries.set(key, geometry);
    this.keyByEdge.set(edge.id, key);
    this.link(edge.from, edge.id);
    this.link(edge.to, edge.id);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Invalidates the edges incident to a node — O(deg), the whole point of the adjacency map. */
  invalidateNode(nodeId: string): number {
    const edges = this.byNode.get(nodeId);
    if (edges === undefined) return 0;
    let dropped = 0;
    for (const edgeId of edges) dropped += this.invalidateEdge(edgeId);
    return dropped;
  }

  invalidateEdge(edgeId: string): number {
    const key = this.keyByEdge.get(edgeId);
    if (key === undefined) return 0;
    this.keyByEdge.delete(edgeId);
    return this.entries.delete(key) ? 1 : 0;
  }

  /** Bumps the obstacle epoch: every orthogonal/smart key minted afterwards misses (07 §8.1). */
  bumpObstacleEpoch(): number {
    this.epoch += 1;
    return this.epoch;
  }

  clear(): void {
    this.entries.clear();
    this.byNode.clear();
    this.keyByEdge.clear();
  }

  private link(nodeId: string, edgeId: string): void {
    const set = this.byNode.get(nodeId);
    if (set === undefined) this.byNode.set(nodeId, new Set([edgeId]));
    else set.add(edgeId);
  }
}
