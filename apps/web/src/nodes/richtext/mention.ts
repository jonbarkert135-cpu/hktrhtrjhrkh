/**
 * `@`-mentions of other nodes (P4 §5.4). A mention is two things at once: an inline reference in
 * the text, and — on accept — a real `references` edge in the graph, because an investigation's
 * connections must live in the document, not only inside a paragraph.
 *
 * The suggestion popup is plain DOM on purpose. It is mounted inside the editor's own container by
 * the caller, so it inherits the card's stacking context and cannot be clipped by the canvas
 * overlay, and it has no React lifecycle to coordinate with ProseMirror's.
 */

import Mention from '@tiptap/extension-mention';
import type { Editor, Extension, Node as TipTapNode, Range } from '@tiptap/core';
import type { SuggestionOptions } from '@tiptap/suggestion';

export interface MentionCandidate {
  id: string;
  title: string;
  typeLabel: string;
}

export interface MentionHandlers {
  /** Board nodes matching `query`, best first. The caller owns ranking; this file owns the UI. */
  search: (query: string) => MentionCandidate[];
  /** Called once the user picks a candidate — this is where the `references` edge is created. */
  onAccept: (candidate: MentionCandidate) => void;
  /** False once the mentioned node is gone, so the reference degrades instead of lying. */
  exists?: (id: string) => boolean;
}

/** How many candidates the popup shows; more than this and the list stops being scannable. */
export const MENTION_LIMIT = 8;

interface PopupHost {
  element: HTMLElement;
  render(items: readonly MentionCandidate[], selected: number): void;
  destroy(): void;
}

export function createMentionPopup(onPick: (candidate: MentionCandidate) => void): PopupHost {
  const element = document.createElement('div');
  element.className = 'nx-mention-popup';
  element.setAttribute('role', 'listbox');
  element.setAttribute('aria-label', 'Mention a node');

  return {
    element,
    render(items, selected) {
      element.replaceChildren();
      if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'nx-mention-empty';
        empty.textContent = 'No node matches. Keep typing to write it as plain text.';
        element.append(empty);
        return;
      }
      items.forEach((item, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'nx-mention-option';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', index === selected ? 'true' : 'false');
        option.dataset['mentionId'] = item.id;
        option.textContent =
          item.title === '' ? `Untitled ${item.typeLabel.toLowerCase()}` : item.title;
        const meta = document.createElement('span');
        meta.className = 'nx-mention-meta';
        meta.textContent = item.typeLabel;
        option.append(meta);
        option.addEventListener('mousedown', (event) => {
          // mousedown, not click: the editor must not lose the selection before we insert.
          event.preventDefault();
          onPick(item);
        });
        element.append(option);
      });
    },
    destroy() {
      element.remove();
    },
  };
}

/**
 * The suggestion driver: keeps the highlighted index, feeds the popup and turns Enter/Tab into an
 * insertion. Split from the extension so it can be tested without a ProseMirror view.
 */
export function mentionSuggestion(
  handlers: MentionHandlers,
  mount: () => HTMLElement | null,
): Omit<SuggestionOptions<MentionCandidate>, 'editor'> {
  let popup: PopupHost | null = null;
  let items: MentionCandidate[] = [];
  let selected = 0;
  let pick: (candidate: MentionCandidate) => void = () => undefined;

  const paint = (): void => popup?.render(items, selected);

  return {
    char: '@',
    allowSpaces: false,
    items: ({ query }: { query: string }) => handlers.search(query).slice(0, MENTION_LIMIT),
    // Typed explicitly: the upstream `props` is `any`, and an untyped payload is how a mention
    // would silently start inserting the wrong id.
    command: ({
      editor,
      range,
      props,
    }: {
      editor: Editor;
      range: Range;
      props: MentionCandidate;
    }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'mention', attrs: { id: props.id, label: props.title } },
          { type: 'text', text: ' ' },
        ])
        .run();
      handlers.onAccept(props);
    },
    render: () => ({
      onStart: (props) => {
        items = [...props.items];
        selected = 0;
        pick = (candidate) => props.command(candidate);
        popup = createMentionPopup((candidate) => pick(candidate));
        mount()?.append(popup.element);
        paint();
      },
      onUpdate: (props) => {
        items = [...props.items];
        selected = Math.min(selected, Math.max(0, items.length - 1));
        pick = (candidate) => props.command(candidate);
        paint();
      },
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowDown') {
          selected = items.length === 0 ? 0 : (selected + 1) % items.length;
          paint();
          return true;
        }
        if (event.key === 'ArrowUp') {
          selected = items.length === 0 ? 0 : (selected - 1 + items.length) % items.length;
          paint();
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const candidate = items[selected];
          if (candidate === undefined) return false;
          pick(candidate);
          return true;
        }
        if (event.key === 'Escape') {
          popup?.destroy();
          popup = null;
          return true;
        }
        return false;
      },
      onExit: () => {
        popup?.destroy();
        popup = null;
        items = [];
        selected = 0;
      },
    }),
  };
}

/**
 * The mention node itself. `exists` is consulted at render time so a mention of a deleted node
 * reads as "deleted node" rather than as a dangling name; undoing the deletion restores both the
 * node and the label on the next render of the paragraph.
 */
export function nodeMention(
  handlers: MentionHandlers,
  mount: () => HTMLElement | null,
): TipTapNode {
  return Mention.extend({
    renderHTML({ node, HTMLAttributes }) {
      const id = typeof node.attrs['id'] === 'string' ? node.attrs['id'] : '';
      const label = typeof node.attrs['label'] === 'string' ? node.attrs['label'] : '';
      const missing = handlers.exists !== undefined && id !== '' && !handlers.exists(id);
      return [
        'span',
        {
          ...HTMLAttributes,
          class: 'nx-mention',
          'data-mention-id': id,
          ...(missing ? { 'data-missing': 'true' } : {}),
        },
        missing ? 'deleted node' : `@${label === '' ? 'untitled' : label}`,
      ];
    },
  }).configure({ suggestion: mentionSuggestion(handlers, mount) });
}

export type MentionExtension = Extension | TipTapNode;
