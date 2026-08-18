/**
 * The editor's schema (P4 §5.4): bold, italic, strikethrough, inline code, H2/H3, bullet, ordered
 * and task lists, blockquote, code block, link and `@`-mentions — and nothing else. Every mark we
 * do not list is a mark the document can never contain, which is the cheap half of sanitisation:
 * pasted HTML is parsed against this schema, so a `<script>` or an `onerror` attribute has nowhere
 * to land (§7).
 *
 * Images are intentionally absent: an image is a node on the canvas, not a character in a note.
 */

import type { AnyExtension } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import type * as Y from 'yjs';

import { FragmentSync } from './fragmentSync.ts';
import { nodeMention, type MentionHandlers } from './mention.ts';

export interface RichTextExtensionOptions {
  fragment: Y.XmlFragment | null;
  placeholder?: string;
  mention?: MentionHandlers | undefined;
  /** Where the mention popup is appended; the editor container, so it is never clipped. */
  mentionMount?: (() => HTMLElement | null) | undefined;
}

/** Only http(s) links are storable — the same rule the URL fields use (§9). */
export const LINK_PROTOCOLS = ['http', 'https'] as const;

export function richTextExtensions(options: RichTextExtensionOptions): AnyExtension[] {
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      // Undo belongs to the board, not to the text box: y-prosemirror + the board UndoManager own
      // it. Leaving ProseMirror's own history in would give ⌘Z two contradictory meanings.
      history: false,
      heading: { levels: [2, 3] },
      // A note is not a document: no top-level H1 competing with the node title.
      codeBlock: { HTMLAttributes: { class: 'nx-code-block' } },
    }),
    TaskList.configure({ HTMLAttributes: { class: 'nx-task-list' } }),
    TaskItem.configure({ nested: true }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: [...LINK_PROTOCOLS],
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    Placeholder.configure({ placeholder: options.placeholder ?? 'Write what you found…' }),
    FragmentSync.configure({ fragment: options.fragment }),
  ];

  if (options.mention !== undefined) {
    extensions.push(nodeMention(options.mention, options.mentionMount ?? (() => null)));
  }
  return extensions;
}
