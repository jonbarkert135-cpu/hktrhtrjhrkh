/**
 * Edge validation (07_EDGE_SYSTEM.md §3.4, §9 and P5 requirement 12). Two severities with very
 * different consequences:
 *
 * - `error` blocks creation (self-loops on types that forbid them, duplicates, an over-long label,
 *   an inverted validity range, a tool/AI edge without provenance);
 * - `warning` never blocks. An unusual endpoint pair is created anyway, with confidence forced to
 *   `unknown` — OSINT graphs regularly need relationships the taxonomy did not anticipate, and
 *   blocking them would push analysts to `references` and destroy the semantics.
 */

import type { BoardEdge } from '../entities/edge.ts';
import type { EdgeTypeRegistry } from './registry.ts';
import { edgeIdentityKey, isPairAllowed } from './semantics.ts';
import type { EdgeValidationIssue } from './types.ts';

/** Stored label cap (07 §2 schema, §9 security). Longer labels are rejected, never truncated. */
export const EDGE_LABEL_MAX = 200;

export interface EdgeCandidate {
  readonly type: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  /** Node *types* of the endpoints, used for the endpoint rules. */
  readonly sourceNodeType: string;
  readonly targetNodeType: string;
  readonly directed: boolean;
  readonly label?: string;
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
  /** How the edge came to be; tool/AI edges must carry provenance (§9). */
  readonly provenanceKind?: string;
  readonly provenanceTool?: string | null;
}

export interface ValidationResult {
  readonly issues: readonly EdgeValidationIssue[];
  /** True when nothing of severity `error` was found. */
  readonly ok: boolean;
  /** Set when an identical relationship already exists — the UI offers to open it. */
  readonly duplicateOf: string | null;
  /** True when the endpoint pair is unusual: create the edge, but with `unknown` confidence. */
  readonly forceUnknownConfidence: boolean;
}

const TOOL_KINDS = new Set(['tool', 'ai']);

export function validateEdgeCandidate(
  registry: EdgeTypeRegistry,
  candidate: EdgeCandidate,
  existing: readonly BoardEdge[] = [],
): ValidationResult {
  const issues: EdgeValidationIssue[] = [];
  const definition = registry.get(candidate.type);
  let duplicateOf: string | null = null;

  if (!registry.has(candidate.type)) {
    issues.push({
      code: 'unknown-edge-type',
      severity: 'warning',
      message: `Relationship type "${candidate.type}" is not registered; it is drawn as a custom relationship.`,
    });
  }

  if (candidate.sourceNodeId === candidate.targetNodeId && !definition.allowSelfLoop) {
    issues.push({
      code: 'self-loop',
      severity: 'error',
      message: `"${definition.label}" cannot connect a node to itself. Pick a different relationship, or connect two nodes.`,
    });
  }

  const key = identityKeyOf(candidate);
  for (const edge of existing) {
    if (edge.status !== 'active') continue;
    if (edgeIdentityKey(edge) !== key) continue;
    duplicateOf = edge.id;
    issues.push({
      code: 'duplicate-edge',
      severity: 'error',
      message: `These nodes are already connected with "${definition.label}". Open the existing relationship to edit it.`,
      edgeId: edge.id,
    });
    break;
  }

  const label = candidate.label ?? '';
  if (label.length > EDGE_LABEL_MAX) {
    issues.push({
      code: 'label-too-long',
      severity: 'error',
      message: `The label is ${String(label.length)} characters; the maximum is ${String(EDGE_LABEL_MAX)}.`,
    });
  }

  const from = candidate.validFrom ?? null;
  const to = candidate.validTo ?? null;
  if (from !== null && to !== null && Date.parse(to) < Date.parse(from)) {
    issues.push({
      code: 'time-range-inverted',
      severity: 'error',
      message: 'The relationship ends before it starts. Check "valid from" and "valid to".',
    });
  }

  const kind = candidate.provenanceKind ?? 'manual';
  if (TOOL_KINDS.has(kind) && (candidate.provenanceTool ?? '') === '') {
    issues.push({
      code: 'missing-provenance',
      severity: 'error',
      message:
        'A relationship created by a tool or the assistant must record which tool produced it.',
    });
  }

  const unusual = !isPairAllowed(definition, candidate.sourceNodeType, candidate.targetNodeType);
  if (unusual) {
    issues.push({
      code: 'unusual-endpoints',
      severity: 'warning',
      message: `"${definition.label}" is unusual between ${candidate.sourceNodeType} and ${candidate.targetNodeType}. The relationship is kept, with unverified confidence.`,
    });
  }

  return {
    issues,
    ok: !issues.some((issue) => issue.severity === 'error'),
    duplicateOf,
    forceUnknownConfidence: unusual,
  };
}

/** Identity key for a candidate, matching `edgeIdentityKey` for stored edges. */
function identityKeyOf(candidate: EdgeCandidate): string {
  const a = candidate.sourceNodeId;
  const b = candidate.targetNodeId;
  const [source, target] = candidate.directed || a <= b ? [a, b] : [b, a];
  return [
    candidate.type,
    candidate.directed ? 'directed' : 'undirected',
    source ?? '',
    target ?? '',
  ].join('|');
}
