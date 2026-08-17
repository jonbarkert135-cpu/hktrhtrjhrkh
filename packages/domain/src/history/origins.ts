/**
 * Undo scope by origin (08_DATA_MODEL.md §2.5, P3 §7). The document uses the granular origin
 * vocabulary from `doc/transactions.ts`; this module names the four *classes* the UI reasons about
 * and derives the tracked set from them, so the two can never drift.
 */

import {
  LOCAL_ORIGINS,
  isLocalOrigin,
  type LocalOrigin,
  type Origin,
} from '../doc/transactions.ts';

/** A gesture the user performed directly (create, edit, move, delete, paste, layout). */
export const LOCAL_USER: LocalOrigin = 'local:edit';
/** Applying an import or an accepted proposal: undoable, because the user asked for it. */
export const LOCAL_IMPORT: LocalOrigin = 'local:proposal-apply';
/** Anything arriving from another client or a background job: never undoable locally (N3). */
export const REMOTE: Origin = 'remote:sync';
/** Migrations, GC and repairs: never undoable. */
export const SYSTEM: Origin = 'system:migration';

/** The exact origin strings `Y.UndoManager` tracks. */
export const TRACKED_ORIGINS: ReadonlySet<string> = new Set<string>(LOCAL_ORIGINS);

export function isUndoable(origin: unknown): boolean {
  return isLocalOrigin(origin);
}
