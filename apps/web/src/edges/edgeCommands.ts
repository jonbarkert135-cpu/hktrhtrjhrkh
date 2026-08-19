/**
 * Everything the edge UI does to the document, in one place (P5 §5.11, §5.12).
 *
 * The inspector and the context menu are two views of the same commands, so the commands live
 * apart from both: each is one transaction, one undo step, and each returns a plain result the UI
 * turns into a message. No React, no DOM — these are unit-testable against a bare `Y.Doc`.
 */

import {
  builtinEdgeTypes,
  getEdge,
  getNode,
  listEdges,
  removeEdges,
  updateEdge,
  validateEdgeCandidate,
  EDGE_LABEL_MAX,
  type BoardEdge,
  type BoardHistory,
  type EdgeValidationIssue,
  type RoutingMode,
} from '@nexus/domain';
import type * as Y from 'yjs';

export interface EdgeCommandContext {
  doc: Y.Doc;
  history?: BoardHistory | undefined;
  now?: () => string;
}

export interface EdgeCommandResult {
  ok: boolean;
  /** Analyst-facing sentence when the command was refused, or `null`. */
  message: string | null;
}

const ok: EdgeCommandResult = { ok: true, message: null };

const stamp = (context: EdgeCommandContext): string =>
  (context.now ?? ((): string => new Date().toISOString()))();

function commit(
  context: EdgeCommandContext,
  label: string,
  patch: Record<string, unknown>,
  id: string,
): EdgeCommandResult {
  const now = stamp(context);
  context.history?.label(label);
  const changed = updateEdge(context.doc, id, patch, { origin: 'local:edit', now });
  context.history?.separate();
  return changed ? ok : { ok: false, message: 'This relationship no longer exists.' };
}

/** Blocking issues only; warnings are shown but never stop a command. */
export const blockingIssue = (
  issues: readonly EdgeValidationIssue[],
): EdgeValidationIssue | undefined => issues.find((issue) => issue.severity === 'error');

/**
 * Changing the relationship type re-runs validation, because the new type may forbid a self-loop
 * or collide with an existing relationship of that type (§5.12).
 */
export function setEdgeType(
  context: EdgeCommandContext,
  id: string,
  type: string,
): EdgeCommandResult {
  const edge = getEdge(context.doc, id);
  if (edge === undefined) return { ok: false, message: 'This relationship no longer exists.' };
  if (edge.type === type) return ok;
  const registry = builtinEdgeTypes();
  const source = getNode(context.doc, edge.source.nodeId);
  const target = getNode(context.doc, edge.target.nodeId);
  const result = validateEdgeCandidate(
    registry,
    {
      type,
      sourceNodeId: edge.source.nodeId,
      targetNodeId: edge.target.nodeId,
      sourceNodeType: source?.type ?? 'unknown',
      targetNodeType: target?.type ?? 'unknown',
      directed: registry.get(type).directed,
      label: edge.label,
      provenanceKind: 'manual',
    },
    listEdges(context.doc).filter((other) => other.id !== id),
  );
  const blocker = blockingIssue(result.issues);
  if (blocker !== undefined) return { ok: false, message: blocker.message };
  return commit(
    context,
    'change relationship type',
    {
      type,
      directed: registry.get(type).directed,
      ...(result.forceUnknownConfidence ? { confidence: 'unknown' } : {}),
    },
    id,
  );
}

export function setEdgeLabel(
  context: EdgeCommandContext,
  id: string,
  label: string,
): EdgeCommandResult {
  if (label.length > EDGE_LABEL_MAX) {
    return {
      ok: false,
      message: `The label is ${String(label.length)} characters; the maximum is ${String(EDGE_LABEL_MAX)}.`,
    };
  }
  return commit(context, 'label relationship', { label }, id);
}

export function setEdgeRouting(
  context: EdgeCommandContext,
  id: string,
  routing: RoutingMode,
): EdgeCommandResult {
  const edge = getEdge(context.doc, id);
  if (edge === undefined) return { ok: false, message: 'This relationship no longer exists.' };
  return commit(context, 'change routing', { style: { ...edge.style, routing } }, id);
}

export function setEdgeDirected(
  context: EdgeCommandContext,
  id: string,
  directed: boolean,
): EdgeCommandResult {
  return commit(context, directed ? 'make directed' : 'make undirected', { directed }, id);
}

export function setEdgeConfidence(
  context: EdgeCommandContext,
  id: string,
  confidence: BoardEdge['confidence'],
): EdgeCommandResult {
  return commit(context, 'set confidence', { confidence }, id);
}

/** Swaps the endpoints; the label and everything else ride along in the same transaction. */
export function reverseEdge(context: EdgeCommandContext, id: string): EdgeCommandResult {
  const edge = getEdge(context.doc, id);
  if (edge === undefined) return { ok: false, message: 'This relationship no longer exists.' };
  return commit(
    context,
    'reverse relationship',
    { source: { ...edge.target }, target: { ...edge.source } },
    id,
  );
}

export function deleteEdge(context: EdgeCommandContext, id: string): EdgeCommandResult {
  const now = stamp(context);
  if (getEdge(context.doc, id) === undefined) {
    return { ok: false, message: 'This relationship no longer exists.' };
  }
  context.history?.label('delete relationship');
  removeEdges(context.doc, [id], { origin: 'local:delete', now });
  context.history?.separate();
  return ok;
}
