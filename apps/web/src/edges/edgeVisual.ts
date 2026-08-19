/**
 * Relationship record → `EdgeView` (P5 §5.1, §5.2; 07_EDGE_SYSTEM.md §2.3).
 *
 * The engine paints numbers, not semantics: this module is the one place that turns a stored edge
 * plus its type definition into a colour, a width, a dash pattern and a routing mode. Colours come
 * from the design tokens the type names — no literal palette lives here.
 */

import type { AnchorSpec, EdgeView, RGBA } from '@nexus/canvas-engine';
import {
  builtinEdgeTypes,
  dashPattern,
  resolveEdgeVisual,
  type BoardEdge,
  type RoutingMode,
} from '@nexus/domain';

/** Resolves a design token to a colour; the board passes the canvas theme resolver. */
export type ColorResolver = (token: string) => RGBA;

const FALLBACK_STROKE: RGBA = { r: 153, g: 161, b: 179, a: 1 };

const anchorOf = (port: BoardEdge['source']['port'], offset: number): AnchorSpec =>
  port === 'auto' ? { side: 'auto', t: offset } : { side: port, t: offset };

/**
 * `arrowSource` / `arrowTarget` are arrowhead *names* in the domain; the engine only knows
 * "is there a head". Everything except `none` draws one.
 */
const hasHead = (head: string): boolean => head !== 'none';

export interface EdgeViewOptions {
  /** Token → colour. Defaults to a neutral stroke, which is what tests and SSR get. */
  readonly color?: ColorResolver;
  /** Painting order; the caller passes the index in the edge list. */
  readonly index?: number;
  readonly now?: Date;
}

export function edgeToView(edge: BoardEdge, options: EdgeViewOptions = {}): EdgeView {
  const definition = builtinEdgeTypes().get(edge.type);
  const visual = resolveEdgeVisual(edge, definition, options.now ?? new Date());
  const index = options.index ?? 0;
  const color = options.color?.(visual.strokeToken) ?? FALLBACK_STROKE;
  const dash = dashPattern(visual.dash, visual.width);

  return {
    id: edge.id,
    from: edge.source.nodeId,
    to: edge.target.nodeId,
    fromAnchor: anchorOf(edge.source.port, edge.source.offset),
    toAnchor: anchorOf(edge.target.port, edge.target.offset),
    routing: visual.routing satisfies RoutingMode,
    style: {
      color,
      width: visual.width,
      dash,
      arrowStart: hasHead(visual.arrowSource),
      arrowEnd: hasHead(visual.arrowTarget),
      opacity: visual.opacity,
      // Flow animation is a type-level default (`derived_from` and the inferred types) that an
      // edge's own style may override; `resolveEdgeVisual` has already applied both (07 §10.4).
      animated: visual.animated,
    },
    label: edge.label === '' ? null : edge.label,
    z: index + visual.zBias,
    hidden: edge.hidden || edge.status !== 'active',
    visualVersion: edge.version,
    waypoints: edge.waypoints,
    manualRoute: edge.manualRoute,
  };
}
