/**
 * Engine → document binding (P3 §5.14). The engine emits intents and mutates nothing; this module
 * turns each intent into exactly one transaction, so one gesture is one undo step.
 *
 * Camera and selection intents are deliberately ignored: they are per-user state and never enter
 * the CRDT (08_DATA_MODEL.md §2.3).
 */

import type { Intent } from '@nexus/canvas-engine';
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  addEdge,
  addNode,
  getEdge,
  getNode,
  hasEdge,
  hasNode,
  makeEdge,
  makeNode,
  moveNodes,
  newId,
  removeEdges,
  removeNodes,
  reorder,
  resizeNode,
  updateEdge,
  updateNode,
  type BoardHistory,
} from '@nexus/domain';
import type * as Y from 'yjs';

export interface IntentContext {
  doc: Y.Doc;
  history?: BoardHistory | undefined;
  now: () => string;
  /** Ids are minted client-side so capture works offline (N2). */
  makeId?: (() => string) | undefined;
}

const plural = (count: number, word: string): string =>
  `${String(count)} ${word}${count === 1 ? '' : 's'}`;

/**
 * Gestures whose interim commits must merge into a single undo step; every other intent is a
 * discrete command and gets its own step (08 §2.5).
 */
const CONTINUOUS_INTENTS: ReadonlySet<Intent['t']> = new Set(['move-nodes', 'resize-node']);

const isStillGesturing = (intent: Intent): boolean =>
  CONTINUOUS_INTENTS.has(intent.t) &&
  'phase' in intent &&
  intent.phase !== 'end' &&
  intent.phase !== 'cancel';

/** Applies one engine intent. Returns true when the document changed. */
export function applyIntent(intent: Intent, context: IntentContext): boolean {
  const changed = applyIntentToDoc(intent, context);
  // A finished command must not merge with the next one, or one undo would revert both.
  if (changed && !isStillGesturing(intent)) context.history?.separate();
  return changed;
}

function applyIntentToDoc(intent: Intent, context: IntentContext): boolean {
  const { doc } = context;
  const now = context.now();
  const makeId = context.makeId ?? ((): string => newId.board());
  const label = (text: string): void => {
    context.history?.label(text);
  };

  switch (intent.t) {
    case 'move-nodes': {
      // Interim commits during a drag keep collaborators in sync; the capture timeout merges them
      // into one undo step (08 §2.4).
      if (intent.phase === 'cancel') return false;
      const moves = intent.deltas
        .map((delta) => {
          const node = getNode(doc, delta.id);
          return node === undefined
            ? null
            : { id: delta.id, x: node.x + delta.dx, y: node.y + delta.dy };
        })
        .filter((move): move is { id: string; x: number; y: number } => move !== null);
      if (moves.length === 0) return false;
      label(`move ${plural(moves.length, 'node')}`);
      moveNodes(doc, moves, { origin: 'local:move', now });
      return true;
    }

    case 'resize-node': {
      if (intent.phase === 'cancel') return false;
      label('resize node');
      return resizeNode(
        doc,
        intent.id,
        { x: intent.x, y: intent.y, w: intent.w, h: intent.h },
        { origin: 'local:edit', now },
      );
    }

    case 'delete': {
      const nodeIds = intent.ids.filter((id) => hasNode(doc, id));
      const edgeIds = intent.ids.filter((id) => hasEdge(doc, id));
      if (nodeIds.length === 0 && edgeIds.length === 0) return false;
      label(`delete ${plural(nodeIds.length + edgeIds.length, 'item')}`);
      if (nodeIds.length > 0) removeNodes(doc, nodeIds, { origin: 'local:delete', now });
      if (edgeIds.length > 0) removeEdges(doc, edgeIds, { origin: 'local:delete', now });
      return true;
    }

    case 'create-edge': {
      if (!hasNode(doc, intent.from) || !hasNode(doc, intent.to)) return false;
      label('connect 2 nodes');
      addEdge(doc, makeEdge({ id: makeId(), from: intent.from, to: intent.to }, now), {
        origin: 'local:create',
        now,
      });
      return true;
    }

    case 'reconnect-edge': {
      const edge = getEdge(doc, intent.edgeId);
      if (edge === undefined || !hasNode(doc, intent.to)) return false;
      const end = intent.end === 'from' ? 'source' : 'target';
      label('reconnect edge');
      return updateEdge(
        doc,
        intent.edgeId,
        { [end]: { ...edge[end], nodeId: intent.to } },
        { origin: 'local:edit', now },
      );
    }

    case 'create-node-from-drop': {
      const payload = intent.payload;
      const title =
        payload.kind === 'url'
          ? (payload.text ?? 'Link')
          : payload.kind === 'text'
            ? (payload.text ?? '').slice(0, 96)
            : (payload.files?.[0]?.name ?? 'File');
      label('create 1 node');
      addNode(
        doc,
        makeNode(
          {
            id: makeId(),
            type: payload.kind === 'url' ? 'website' : payload.kind === 'files' ? 'file' : 'note',
            x: intent.at.x - DEFAULT_NODE_WIDTH / 2,
            y: intent.at.y - DEFAULT_NODE_HEIGHT / 2,
            title,
            data: payload.kind === 'text' ? { text: payload.text ?? '' } : {},
            provenance: {
              kind: 'drop',
              source: payload.kind === 'url' ? (payload.text ?? null) : null,
              observedAt: now,
              importedAt: now,
            },
          },
          now,
        ),
        { origin: 'local:create', now },
      );
      return true;
    }

    case 'z-order': {
      const ids = intent.ids.filter((id) => hasNode(doc, id));
      if (ids.length === 0) return false;
      label(`reorder ${plural(ids.length, 'item')}`);
      reorder(doc, ids, intent.op, { origin: 'local:layout', now });
      return true;
    }

    case 'lock': {
      let changed = false;
      for (const id of intent.ids) {
        changed =
          updateNode(doc, id, { locked: intent.locked }, { origin: 'local:edit', now }) || changed;
      }
      if (changed) label(intent.locked ? 'lock nodes' : 'unlock nodes');
      return changed;
    }

    default:
      // select / camera / context-menu / begin-edit-text / group / align / distribute are either
      // ephemeral (08 §2.3) or land in later phases.
      return false;
  }
}

/** Creates a note at a world position — the "N" shortcut and the toolbar button (P3 §6). */
export function createNoteNode(
  context: IntentContext,
  at: { x: number; y: number },
  title = 'New note',
): string {
  const now = context.now();
  const id = (context.makeId ?? ((): string => newId.board()))();
  context.history?.label('create 1 node');
  addNode(
    context.doc,
    makeNode(
      {
        id,
        type: 'note',
        x: at.x - DEFAULT_NODE_WIDTH / 2,
        y: at.y - DEFAULT_NODE_HEIGHT / 2,
        title,
        data: { text: '' },
        provenance: { kind: 'manual', observedAt: now, importedAt: now },
      },
      now,
    ),
    { origin: 'local:create', now },
  );
  context.history?.separate();
  return id;
}
