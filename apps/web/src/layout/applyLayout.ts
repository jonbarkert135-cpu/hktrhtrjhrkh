/**
 * Accepting a layout proposal. One `moveNodes` call → one Yjs transaction → **one** undo step,
 * however many thousand nodes moved (`08_DATA_MODEL.md` §2.4, the undo invariant in `AGENTS.md`).
 * The origin is `local:layout`, which the vocabulary already reserved for exactly this.
 */

import { moveNodes } from '@nexus/domain';
import type { LayoutDiff } from '@nexus/layout';
import type * as Y from 'yjs';

export function applyLayoutDiff(doc: Y.Doc, diff: LayoutDiff, now: string): number {
  if (diff.moves.length === 0) return 0;
  moveNodes(
    doc,
    diff.moves.map((move) => ({ id: move.id, x: move.x, y: move.y })),
    { origin: 'local:layout', now },
  );
  return diff.moves.length;
}
