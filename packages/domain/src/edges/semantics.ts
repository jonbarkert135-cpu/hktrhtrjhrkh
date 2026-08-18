/**
 * Relationship semantics (07_EDGE_SYSTEM.md §2.1, §3.4, §5.3): how a pair of node types is
 * matched against a type's endpoint rules, how an edge reads in each direction, how undirected
 * edges are canonicalised, and how the type picker ranks its candidates.
 */

import type { BoardEdge } from '../entities/edge.ts';
import type { EdgeTypeRegistry } from './registry.ts';
import {
  ANY_NODE_TYPE,
  type EdgeCategory,
  type EdgeTypeDefinition,
  type SuggestContext,
} from './types.ts';

/** Scoring weights of §5.3; they sum to 1 so a score is always comparable across projects. */
export const SUGGEST_WEIGHTS = Object.freeze({
  allowed: 0.55,
  frequency: 0.2,
  heuristic: 0.15,
  category: 0.1,
});

/** What plain `E` falls back to when every candidate scores zero. */
export const FALLBACK_EDGE_TYPE = 'references';

const matches = (list: readonly string[], nodeType: string): boolean =>
  list.includes(ANY_NODE_TYPE) || list.includes(nodeType);

/** True when this source→target node type pair is one the relationship expects (§3.4). */
export function isPairAllowed(
  def: EdgeTypeDefinition,
  sourceNodeType: string,
  targetNodeType: string,
): boolean {
  return matchSpecificity(def, sourceNodeType, targetNodeType) > 0;
}

/** A wildcard endpoint is treated as this many node types when measuring specificity. */
const WILDCARD_BREADTH = 16;
/** Floor of the specificity factor: a matching broad rule still beats a non-matching one. */
const SPECIFICITY_FLOOR = 0.6;

const breadth = (list: readonly string[]): number =>
  list.includes(ANY_NODE_TYPE) ? WILDCARD_BREADTH : Math.max(1, list.length);

/**
 * How specific the best matching endpoint rule is, in `(0, 1]`, or 0 when nothing matches.
 * `person → organization` on `works_at` is maximally specific; the same pair on `alias_of`
 * (four types either side) or on `references` (any → any) matches, but says far less — so the
 * picker must not put the vague relationship on top just because its id sorts earlier.
 */
export function matchSpecificity(
  def: EdgeTypeDefinition,
  sourceNodeType: string,
  targetNodeType: string,
): number {
  let best = 0;
  for (const rule of def.allowed) {
    if (!matches(rule.source, sourceNodeType) || !matches(rule.target, targetNodeType)) continue;
    const size = breadth(rule.source) * breadth(rule.target);
    best = Math.max(best, 1 / (1 + Math.log2(size)));
  }
  return best;
}

/**
 * How the edge reads. Forwards it is `label`; backwards — the direction the inspector shows under
 * "Reverse direction" — it is `inverseLabel`. Undirected types read the same either way.
 */
export function readingLabel(def: EdgeTypeDefinition, reversed = false): string {
  return reversed ? def.inverseLabel : def.label;
}

/**
 * Undirected edges are stored with `source.nodeId < target.nodeId` (§2.1) so two clients working
 * offline cannot create mirrored twins and duplicate detection stays a string comparison.
 */
export function normalizeUndirected(edge: BoardEdge): BoardEdge {
  if (edge.directed) return edge;
  if (edge.source.nodeId <= edge.target.nodeId) return edge;
  return {
    ...edge,
    source: edge.target,
    target: edge.source,
    waypoints: [...edge.waypoints].reverse(),
  };
}

/** Stable key for "the same relationship between the same two nodes" (duplicate detection). */
export function edgeIdentityKey(edge: BoardEdge): string {
  const normalized = normalizeUndirected(edge);
  return [
    normalized.type,
    normalized.directed ? 'directed' : 'undirected',
    normalized.source.nodeId,
    normalized.target.nodeId,
  ].join('|');
}

/** Unordered pair key: every edge between the same two nodes, used by multi-edge separation. */
export function nodePairKey(edge: BoardEdge): string {
  const a = edge.source.nodeId;
  const b = edge.target.nodeId;
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

export interface EdgeTypeSuggestion {
  readonly type: string;
  readonly score: number;
  readonly definition: EdgeTypeDefinition;
}

/**
 * Ranked relationship types for a candidate pair (§5.3). Ranking is deterministic: ties break on
 * the type id, so two clients showing the same picker show the same order.
 */
export function suggestEdgeTypes(
  registry: EdgeTypeRegistry,
  sourceNodeType: string,
  targetNodeType: string,
  ctx: SuggestContext = {},
): EdgeTypeSuggestion[] {
  const histogram = ctx.projectHistogram ?? {};
  const maxCount = Math.max(0, ...Object.values(histogram));
  const lastCategory: EdgeCategory | null = ctx.lastUsedCategory ?? null;

  return registry
    .list()
    .map((definition): EdgeTypeSuggestion => {
      const specificity = matchSpecificity(definition, sourceNodeType, targetNodeType);
      const allowed =
        specificity === 0 ? 0 : SPECIFICITY_FLOOR + (1 - SPECIFICITY_FLOOR) * specificity;
      const count = histogram[definition.type] ?? 0;
      const frequency = maxCount === 0 ? 0 : count / maxCount;
      const heuristic = definition.suggest?.(sourceNodeType, targetNodeType, ctx) ?? 0;
      const category = lastCategory !== null && definition.category === lastCategory ? 1 : 0;
      const score =
        SUGGEST_WEIGHTS.allowed * allowed +
        SUGGEST_WEIGHTS.frequency * frequency +
        SUGGEST_WEIGHTS.heuristic * clamp01(heuristic) +
        SUGGEST_WEIGHTS.category * category;
      return { type: definition.type, score, definition };
    })
    .sort((a, b) => (b.score === a.score ? a.type.localeCompare(b.type) : b.score - a.score));
}

/** The type applied by plain `E` / a plain drop: the top suggestion, or `references`. */
export function bestEdgeType(
  registry: EdgeTypeRegistry,
  sourceNodeType: string,
  targetNodeType: string,
  ctx: SuggestContext = {},
): string {
  const [top] = suggestEdgeTypes(registry, sourceNodeType, targetNodeType, ctx);
  if (top === undefined || top.score === 0) return FALLBACK_EDGE_TYPE;
  return top.type;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
