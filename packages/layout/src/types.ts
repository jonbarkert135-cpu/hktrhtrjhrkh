/**
 * The layout engine's vocabulary. Deliberately its own, tiny value types rather than
 * `@nexus/domain`'s `BoardNode`: layout is pure geometry over a graph and must stay usable from a
 * worker, a bench and a test without dragging Yjs (and therefore a document) behind it.
 */

export interface LayoutNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Pinned or locked nodes keep their coordinates and act as obstacles (03_UX.md §16). */
  readonly pinned?: boolean | undefined;
  /** ISO instant used by the timeline algorithm; absent means "undated". */
  readonly observedAt?: string | null | undefined;
  /** Cluster/lane key (group id, tag or type) used by `cluster` and `timeline`. */
  readonly group?: string | null | undefined;
}

export interface LayoutEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

export interface LayoutGraph {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
}

export const LAYOUT_ALGORITHMS = [
  'hierarchical',
  'tree',
  'radial',
  'force',
  'flow',
  'timeline',
  'cluster',
] as const;

export type LayoutAlgorithmId = (typeof LAYOUT_ALGORITHMS)[number];

export function isLayoutAlgorithmId(value: unknown): value is LayoutAlgorithmId {
  return typeof value === 'string' && (LAYOUT_ALGORITHMS as readonly string[]).includes(value);
}

export type LayoutDirection = 'down' | 'up' | 'right' | 'left';

export interface LayoutOptions {
  /** Seeded PRNG input: the same seed and the same graph always produce the same result. */
  readonly seed?: number;
  /** Gap between neighbouring nodes along the primary axis. */
  readonly spacingX?: number;
  /** Gap between ranks/lanes. */
  readonly spacingY?: number;
  /** Primary flow direction for `hierarchical`, `tree` and `flow`. */
  readonly direction?: LayoutDirection;
  /** Iteration budget for `force`; ignored elsewhere. */
  readonly iterations?: number;
  /** Keep the laid-out cluster centred on where the nodes are now (default true). */
  readonly preserveCentroid?: boolean;
}

export interface LayoutPosition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface LayoutStats {
  readonly moved: number;
  readonly unchanged: number;
  readonly pinned: number;
  /** Bounding box of the proposed positions, for the preview and camera framing. */
  readonly bounds: { x: number; y: number; w: number; h: number };
  /** Overlapping node pairs left after the separation pass — 0 for a healthy layout. */
  readonly overlaps: number;
}

export interface LayoutResult {
  readonly algorithm: LayoutAlgorithmId;
  readonly seed: number;
  readonly positions: readonly LayoutPosition[];
  readonly stats: LayoutStats;
}

export interface LayoutMove {
  readonly id: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The previewable, reversible unit: what an accept would write, and nothing else. */
export interface LayoutDiff {
  readonly algorithm: LayoutAlgorithmId;
  readonly seed: number;
  readonly moves: readonly LayoutMove[];
  readonly stats: LayoutStats;
}

/** Cooperative cancellation + progress, so a 5,000-node run can be abandoned mid-flight. */
export interface LayoutRunContext {
  readonly isCancelled?: () => boolean;
  readonly onProgress?: (fraction: number) => void;
}

export class LayoutCancelledError extends Error {
  constructor() {
    super('Layout cancelled');
    this.name = 'LayoutCancelledError';
  }
}
