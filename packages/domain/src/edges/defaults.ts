/**
 * Resolving what an edge actually looks like (07_EDGE_SYSTEM.md §2.3, §4.1). The document stores
 * only overrides — `null` everywhere means "use the type default" — so exactly one function turns
 * (edge, type definition) into the concrete values the renderer paints with.
 *
 * The result is a plain data object of tokens and numbers: no colours are resolved here, because
 * theme resolution belongs to the UI layer and the domain package must stay renderer-agnostic.
 */

import type { BoardEdge } from '../entities/edge.ts';
import type { ArrowHead, DashStyle, EdgeTypeDefinition, RoutingMode } from './types.ts';

/**
 * Belief in the claim maps to opacity (07 §2.3). The five buckets are fixed so the renderer can
 * batch strokes by alpha without the bucket count exploding.
 */
export const CONFIDENCE_OPACITY: Readonly<Record<BoardEdge['confidence'], number>> = Object.freeze({
  high: 0.92,
  medium: 0.78,
  low: 0.6,
  unknown: 0.45,
});

/** Weight is importance, not belief: it drives stroke width only. */
export const MIN_STROKE_WIDTH = 0.75;
export const MAX_STROKE_WIDTH = 4;
/** Below this length in canvas units every routing mode degrades to `straight` (07 §7.2). */
export const STRAIGHT_DEGRADE_LENGTH = 40;
/** Opacity multiplier for a relationship that has stopped being true (`validTo` in the past). */
export const PAST_EDGE_OPACITY_FACTOR = 0.55;

export interface ResolvedEdgeVisual {
  routing: RoutingMode;
  strokeToken: string;
  width: number;
  dash: DashStyle;
  arrowSource: ArrowHead;
  arrowTarget: ArrowHead;
  animated: boolean;
  opacity: number;
  labelPosition: number;
  labelOffset: { dx: number; dy: number };
  cornerRadius: number;
  curvature: number;
  zBias: number;
}

export const DEFAULT_CURVATURE = 0.35;
export const DEFAULT_CORNER_RADIUS = 8;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Weak claims are dashed even when the type is solid: uncertainty must be visible at a glance. */
const isWeak = (confidence: BoardEdge['confidence']): boolean =>
  confidence === 'low' || confidence === 'unknown';

/** `validTo` in the past means the relationship ended; it is drawn faded (07 §2.2). */
export function isPastEdge(edge: BoardEdge, now: Date): boolean {
  if (edge.validTo === null) return false;
  const ended = Date.parse(edge.validTo);
  return Number.isNaN(ended) ? false : ended < now.getTime();
}

export function resolveEdgeVisual(
  edge: BoardEdge,
  def: EdgeTypeDefinition,
  now: Date = new Date(),
): ResolvedEdgeVisual {
  const style = edge.style;
  const directed = edge.directed;
  const widthOverride = style.width;
  const baseWidth = widthOverride ?? def.width + edge.weight * 2 - 1;
  const opacity = CONFIDENCE_OPACITY[edge.confidence];

  return {
    routing: style.routing ?? def.defaultRouting,
    strokeToken: style.stroke ?? def.strokeToken,
    width: clamp(baseWidth, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH),
    dash: dashOf(style.dash, def, edge.confidence),
    arrowSource: arrowOf(style.arrowSource, def.arrowSource, directed),
    arrowTarget: arrowOf(style.arrowTarget, def.arrowTarget, directed),
    animated: style.animated ?? def.animated,
    opacity: isPastEdge(edge, now) ? opacity * PAST_EDGE_OPACITY_FACTOR : opacity,
    labelPosition: style.labelPosition,
    labelOffset: { dx: style.labelOffset.dx, dy: style.labelOffset.dy },
    cornerRadius: style.cornerRadius ?? DEFAULT_CORNER_RADIUS,
    curvature: style.curvature ?? DEFAULT_CURVATURE,
    zBias: style.zBias,
  };
}

/**
 * The stored dash is a numeric pattern (08 §2.2.3) while the taxonomy speaks in names; an explicit
 * numeric override wins, otherwise the type's name is used, dashed when the claim is weak.
 */
function dashOf(
  override: readonly number[] | null,
  def: EdgeTypeDefinition,
  confidence: BoardEdge['confidence'],
): DashStyle {
  if (override !== null && override.length > 0) return 'dashed';
  if (def.dash === 'solid' && isWeak(confidence)) return 'dashed';
  return def.dash;
}

/** An undirected edge never grows an arrowhead, whatever the type default says. */
function arrowOf(override: boolean | null, fallback: ArrowHead, directed: boolean): ArrowHead {
  if (override === false) return 'none';
  const head = override === true && fallback === 'none' ? 'arrow' : fallback;
  if (directed) return head;
  return head === 'dot' || head === 'none' ? head : 'none';
}

/** Numeric dash pattern for the renderer, in canvas units, or `null` for a solid stroke. */
export function dashPattern(dash: DashStyle, width: number): readonly number[] | null {
  switch (dash) {
    case 'solid':
      return null;
    case 'dashed':
      return [width * 4, width * 3];
    case 'dotted':
      return [width, width * 2];
    case 'dash-dot':
      return [width * 4, width * 2, width, width * 2];
  }
}
