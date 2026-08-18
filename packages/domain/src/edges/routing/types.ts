/**
 * The routing vocabulary (07_EDGE_SYSTEM.md §4.3, §7). Every routing mode consumes a `RouteInput`
 * and produces an `EdgeGeometry`, so drawing, hit-testing and label placement are mode-agnostic.
 *
 * This module is pure geometry: no DOM, no canvas, no React. The same functions run on the main
 * thread and inside the routing worker (07 §11.2), which is the whole reason they live in
 * `packages/domain` rather than in the engine.
 */

import { DEFAULT_CORNER_RADIUS, DEFAULT_CURVATURE } from '../defaults.ts';
import type { RoutingMode } from '../types.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The four card sides an edge may leave from; `auto` is resolved by {@link resolvePort}. */
export const PORT_SIDES = ['top', 'right', 'bottom', 'left'] as const;

export type PortSide = (typeof PORT_SIDES)[number];

/** A resolved attachment point: a side plus a 0..1 offset along that side. */
export interface Port {
  readonly side: PortSide;
  /** 0 = the top/left end of the side, 1 = the bottom/right end. */
  readonly t: number;
}

/** A port that may still ask the router to choose the side (`side: 'auto'`). */
export interface PortRequest {
  readonly side: PortSide | 'auto';
  readonly t: number;
}

/** Node geometry as the router sees it. Top-left anchored, canvas units. */
export interface NodeBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Corner radius of the card; 0 for a sharp rectangle (07 §7.4). */
  readonly radius: number;
}

/**
 * A manual waypoint, already materialized into canvas units by the caller (07 §8.3 owns the
 * relative-frame bookkeeping; the router only ever sees absolute points).
 */
export type Waypoint = Point;

/** Drawing commands. Deliberately the SVG/Canvas subset the renderer can replay directly. */
export type PathCommand =
  | { readonly t: 'M'; readonly x: number; readonly y: number }
  | { readonly t: 'L'; readonly x: number; readonly y: number }
  | {
      readonly t: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly t: 'Q';
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    };

export interface BBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** A point on the path plus the tangent angle there, used to rotate arrowheads and labels. */
export interface OrientedPoint {
  readonly x: number;
  readonly y: number;
  /** Radians, `Math.atan2` of the tangent pointing along the path (source → target). */
  readonly angle: number;
}

export type GeometryKind = 'line' | 'bezier' | 'poly';

/** The common output of every routing mode (07 §4.3). */
export interface EdgeGeometry {
  readonly kind: GeometryKind;
  /** The mode that actually produced this geometry — `smart` resolves to one of the others. */
  readonly mode: RoutingMode;
  /** Flattened polyline `[x0, y0, x1, y1, …]` in canvas units. Never shorter than 2 points. */
  readonly flat: Float32Array;
  readonly cmds: readonly PathCommand[];
  readonly bbox: BBox;
  readonly length: number;
  readonly startPoint: OrientedPoint;
  readonly endPoint: OrientedPoint;
  readonly labelAnchor: OrientedPoint;
  /** True when a budget ran out and a cheaper fallback was drawn instead (07 §7.7). */
  readonly degraded: boolean;
  /** Increments on every recompute, so a renderer can cheaply detect a swap. */
  readonly revision: number;
}

/**
 * How many nodes sit between the two endpoints. Injected as a function so the router stays free of
 * the spatial index (which lives in the engine): `smart` is the only consumer (07 §7.8).
 *
 * Arrow-typed property style is used across the routing layer so injected collaborators can be
 * passed around detached without tripping `@typescript-eslint/unbound-method`.
 */
export interface ObstacleSource {
  /** Boxes intersecting the query rectangle, excluding the two endpoint nodes. */
  readonly query: (bbox: BBox) => readonly NodeBox[];
}

export interface RouteInput {
  readonly source: NodeBox;
  readonly target: NodeBox;
  readonly srcPort: PortRequest;
  readonly dstPort: PortRequest;
  readonly waypoints: readonly Waypoint[];
  /** `true` freezes the shape to "polyline through the waypoints" (07 §8.3). */
  readonly manualRoute: boolean;
  readonly mode: RoutingMode;
  /** Position of this edge inside its parallel-edge group, and the group size (07 §7.6). */
  readonly siblingIndex: number;
  readonly siblingCount: number;
  readonly obstacles?: ObstacleSource;
  /** Bezier bow, 0..1. Default {@link DEFAULT_CURVATURE}. */
  readonly curvature: number;
  /** Orthogonal corner rounding in canvas units. Default {@link DEFAULT_CORNER_RADIUS}. */
  readonly cornerRadius: number;
  /** Screen scale, used only for the "degrade below 40 screen px" rule (07 §7.2). */
  readonly zoom: number;
  /** Fidelity of the flattening pass: `draft` is what a drag uses (07 §8.2 rule 2). */
  readonly quality: RouteQuality;
  /** 0..1 along the path where the label sits. Default 0.5 (07 §9.1). */
  readonly labelPosition: number;
}

export type RouteQuality = 'draft' | 'full';

/** Defaults from 07 §7.3 / §7.7 / §9.1. Curvature and corner radius are owned by `defaults.ts`
 * (they are also edge *style* defaults), so the router imports them instead of restating them. */
export const DEFAULT_LABEL_POSITION = 0.5;
/** Visual gap between a card border and the line end (07 §7.4). */
export const ENDPOINT_GAP = 2;
/** Perpendicular spacing between parallel edges (07 §7.6). */
export const SEPARATION = 18;
/** Above this many parallel edges the group is drawn bundled (07 §7.6). */
export const BUNDLE_THRESHOLD = 7;
/** Obstacle inflation for orthogonal routing (07 §7.7). */
export const CLEARANCE = 12;
/** A `RouteInput` with every optional knob defaulted. */
export function withRouteDefaults(
  input: Partial<RouteInput> & Pick<RouteInput, 'source' | 'target'>,
): RouteInput {
  const base: RouteInput = {
    source: input.source,
    target: input.target,
    srcPort: input.srcPort ?? { side: 'auto', t: 0.5 },
    dstPort: input.dstPort ?? { side: 'auto', t: 0.5 },
    waypoints: input.waypoints ?? [],
    manualRoute: input.manualRoute ?? false,
    mode: input.mode ?? 'smart',
    siblingIndex: input.siblingIndex ?? 0,
    siblingCount: input.siblingCount ?? 1,
    curvature: input.curvature ?? DEFAULT_CURVATURE,
    cornerRadius: input.cornerRadius ?? DEFAULT_CORNER_RADIUS,
    zoom: input.zoom ?? 1,
    quality: input.quality ?? 'full',
    labelPosition: input.labelPosition ?? DEFAULT_LABEL_POSITION,
  };
  return input.obstacles === undefined ? base : { ...base, obstacles: input.obstacles };
}
