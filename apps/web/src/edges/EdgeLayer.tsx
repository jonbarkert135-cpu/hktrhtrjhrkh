/**
 * The relationship layer of the board: the two menus that open at a canvas point, plus the small
 * amount of interpretation between an engine intent and "which menu should be open".
 *
 * It lives apart from `BoardWorkspace` because everything here is reachable in a unit test, while
 * the board's canvas half needs a real 2D context. Same reason the P4 card layer is its own module.
 */

import type { Intent } from '@nexus/canvas-engine';
import { getEdge, getNode, hasEdge } from '@nexus/domain';
import type * as Y from 'yjs';

import { ConnectionOverlay } from './ConnectionOverlay.tsx';
import { EdgeContextMenu } from './EdgeContextMenu.tsx';
import type { EdgeCommandContext, EdgeCommandResult } from './edgeCommands.ts';

/** Which relationship menu the last intent asked for, and where on the board it was aimed. */
export interface PendingEdgeUi {
  kind: 'edge' | 'drop';
  /** Edge id for `edge`, the source node id for `drop`. */
  id: string;
  world: { x: number; y: number };
}

/**
 * Intents the relationship layer owns. Everything else belongs to the document binding, so the
 * board can route with one call and no `switch` of its own.
 */
export function pendingFromIntent(intent: Intent): PendingEdgeUi | null {
  if (intent.t === 'context-menu' && intent.target.t === 'edge') {
    return { kind: 'edge', id: intent.target.id, world: intent.at };
  }
  if (intent.t === 'connect-to-empty') {
    return { kind: 'drop', id: intent.from, world: intent.at };
  }
  return null;
}

/** Endpoint titles for the inspector; a deleted endpoint reads as such, never blank. */
export function endpointTitles(
  doc: Y.Doc,
  edgeId: string,
): { source: string; target: string } | undefined {
  const edge = getEdge(doc, edgeId);
  if (edge === undefined) return undefined;
  return {
    source: getNode(doc, edge.source.nodeId)?.title ?? 'Deleted node',
    target: getNode(doc, edge.target.nodeId)?.title ?? 'Deleted node',
  };
}

/** The single selected relationship, if the selection is exactly one edge. */
export function selectedEdgeOf(doc: Y.Doc, selectedIds: readonly string[]): string | null {
  const only = selectedIds.length === 1 ? selectedIds[0] : undefined;
  return only !== undefined && hasEdge(doc, only) ? only : null;
}

export interface EdgeLayerProps {
  doc: Y.Doc;
  context: EdgeCommandContext;
  pending: PendingEdgeUi | null;
  /** World → viewport CSS px, supplied by the canvas host. */
  screenOf: (world: { x: number; y: number }) => { x: number; y: number };
  onClose: () => void;
  /** "New note here and connect" was chosen. */
  onConnectToEmpty: (from: string, at: { x: number; y: number }) => void;
  onEditLabel?: ((id: string) => void) | undefined;
  onResult?: ((result: EdgeCommandResult) => void) | undefined;
}

export function EdgeLayer({
  doc,
  context,
  pending,
  screenOf,
  onClose,
  onConnectToEmpty,
  onEditLabel,
  onResult,
}: EdgeLayerProps) {
  if (pending === null) return null;

  if (pending.kind === 'edge') {
    // The relationship can be deleted between the right-click and this render (a collaborator, an
    // undo); a menu for a gone edge would act on nothing.
    if (!hasEdge(doc, pending.id)) return null;
    return (
      <EdgeContextMenu
        doc={doc}
        edgeId={pending.id}
        context={context}
        at={screenOf(pending.world)}
        onClose={onClose}
        onEditLabel={onEditLabel}
        onResult={onResult}
      />
    );
  }

  return (
    <ConnectionOverlay
      drop={{ from: pending.id, at: pending.world, screen: screenOf(pending.world) }}
      onCreate={(drop) => onConnectToEmpty(drop.from, drop.at)}
      onCancel={onClose}
    />
  );
}
