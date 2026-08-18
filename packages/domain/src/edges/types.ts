/**
 * The relationship type contract (07_EDGE_SYSTEM.md §3.1). An edge type is *data*: a definition
 * object describing what the relationship means, how it reads backwards, which endpoints it
 * expects and how it is painted. Nothing outside `packages/domain/src/edges` may branch on
 * `edge.type` — behaviour is looked up in the registry, exactly like node types (06 §1).
 *
 * `packages/domain` stays free of DOM, React and canvas APIs: colours are design tokens (strings)
 * and arrowheads are enum names the renderer resolves (00_MASTER.md §5 dependency boundary).
 */

import type { EDGE_ROUTINGS } from '../entities/edge.ts';

export type RoutingMode = (typeof EDGE_ROUTINGS)[number];

export const EDGE_CATEGORIES = [
  'identity',
  'social',
  'infrastructure',
  'code',
  'reasoning',
  'structural',
  'temporal',
] as const;

export type EdgeCategory = (typeof EDGE_CATEGORIES)[number];

export const ARROW_HEADS = ['none', 'arrow', 'hollow', 'dot', 'diamond', 'tee'] as const;

export type ArrowHead = (typeof ARROW_HEADS)[number];

export const DASH_STYLES = ['solid', 'dashed', 'dotted', 'dash-dot'] as const;

export type DashStyle = (typeof DASH_STYLES)[number];

/** Wildcard used in endpoint rules: "any node type". */
export const ANY_NODE_TYPE = '*';

/** The fallback relationship type: user-labelled, unconstrained, never removed from the registry. */
export const CUSTOM_EDGE_TYPE = 'custom';

/**
 * One allowed endpoint combination. A pair matches when the source node type is listed in
 * `source` (or `source` contains `*`) and the target node type is listed in `target`.
 */
export interface EndpointRule {
  readonly source: readonly string[];
  readonly target: readonly string[];
}

/**
 * What the suggestion scorer knows about the board it is scoring for (07 §5.3). Both fields are
 * optional so a fresh project — the case with no history at all — still gets a ranked list.
 */
export interface SuggestContext {
  /** How often each relationship type is already used in this project. Raw counts, not shares. */
  readonly projectHistogram?: Readonly<Record<string, number>>;
  /** The category of the last relationship the analyst created, if any. */
  readonly lastUsedCategory?: EdgeCategory | null;
}

/**
 * A relationship type definition. `suggest` is an arrow-typed property rather than a method so it
 * can be passed around detached from its object without tripping `no-unbound-method`.
 */
export interface EdgeTypeDefinition {
  /** Stable id, never renamed — it is what the document stores. */
  readonly type: string;
  /** Human label read forwards: "person **works at** organization". */
  readonly label: string;
  /** Human label read backwards: "organization **employs** person". */
  readonly inverseLabel: string;
  readonly category: EdgeCategory;
  /** Default direction; a single edge may override it (07 §2.1). */
  readonly directed: boolean;
  /** Design token for the stroke colour, e.g. `--edge-identity`. */
  readonly strokeToken: string;
  readonly dash: DashStyle;
  readonly arrowSource: ArrowHead;
  readonly arrowTarget: ArrowHead;
  readonly defaultRouting: RoutingMode;
  readonly animated: boolean;
  readonly allowSelfLoop: boolean;
  /** Base stroke width in canvas units before the weight adjustment (07 §2.3). */
  readonly width: number;
  /**
   * True when the relationship is normally produced by a tool or the assistant rather than
   * asserted by a person; used to dash inferred edges and to require provenance (07 §9).
   */
  readonly inferred: boolean;
  readonly allowed: readonly EndpointRule[];
  /** Type-specific heuristic, 0..1. Defaults to 0 when a definition does not provide one. */
  readonly suggest?: (sourceType: string, targetType: string, ctx: SuggestContext) => number;
}

export type EdgeValidationSeverity = 'error' | 'warning';

export type EdgeValidationCode =
  | 'self-loop'
  | 'duplicate-edge'
  | 'unusual-endpoints'
  | 'label-too-long'
  | 'time-range-inverted'
  | 'missing-provenance'
  | 'unknown-edge-type';

export interface EdgeValidationIssue {
  readonly code: EdgeValidationCode;
  readonly severity: EdgeValidationSeverity;
  /** Analyst-facing sentence: what happened, said plainly. */
  readonly message: string;
  /** The edge this issue points at, when there is one (duplicates point at the existing edge). */
  readonly edgeId?: string;
}
