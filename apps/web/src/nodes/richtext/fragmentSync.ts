/**
 * The Yjs binding for the editor (P4 §5.4–5.5). The editor never owns the content: it is a view of
 * a `Y.XmlFragment` that already lives in the board document, which is what makes two editors on
 * the same node (card + inspector) safe, and what makes P8 collaboration a transport change rather
 * than a rewrite.
 *
 * There is deliberately no `y-undo` plugin here. Undo is a board-level concept — one ⌘Z reverses
 * "the last thing I did", whether that was moving a node or typing in one — so the binding's
 * transactions are opted into the board `UndoManager` instead (`RICH_TEXT_ORIGIN`).
 */

import { Extension } from '@tiptap/core';
import type { Plugin } from '@tiptap/pm/state';
import { ySyncPlugin, ySyncPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';

/**
 * The transaction origin y-prosemirror writes under. `docProvider` passes it to
 * `createBoardHistory({ extraTrackedOrigins })`; without that, typing would not be undoable.
 */
export const RICH_TEXT_ORIGIN: unknown = ySyncPluginKey;

export interface FragmentSyncOptions {
  fragment: Y.XmlFragment | null;
}

export const FragmentSync = Extension.create<FragmentSyncOptions>({
  name: 'nexusFragmentSync',

  addOptions() {
    return { fragment: null };
  },

  addProseMirrorPlugins() {
    const { fragment } = this.options;
    // A missing fragment is not an error: a read-only preview may render before the node exists.
    // y-prosemirror ships untyped plugins; the cast is the one place that knowledge is asserted.
    return fragment === null ? [] : [ySyncPlugin(fragment) as Plugin];
  },
});
