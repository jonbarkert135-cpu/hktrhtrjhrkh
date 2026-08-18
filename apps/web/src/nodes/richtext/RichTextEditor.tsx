/**
 * The rich-text surface (P4 §5.4–5.5). The same component serves both places a note can be edited:
 * in place on the card and in the inspector. Both bind to the same `Y.XmlFragment`, so having both
 * open is not a conflict — it is two views of one CRDT.
 *
 * What the component owns: the toolbar, the size guard, `@`-mention wiring and the plain-text
 * projection. What it deliberately does not own: the content (the document does), undo (the board
 * does) and layout (the card does).
 */

import {
  addEdge,
  bodyFragmentKey,
  builtinNodeTypes,
  ensureFragment,
  listNodes,
  makeEdge,
  newId,
  type BoardNode,
  type RichTextSizeIssue,
} from '@nexus/domain';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { richTextExtensions } from './extensions.ts';
import type { MentionCandidate } from './mention.ts';
import { commitRichText } from './projection.ts';

/** How long typing may run before the plain-text projection is refreshed (P4 §10). */
export const PROJECTION_DEBOUNCE_MS = 400;

export interface RichTextEditorProps {
  doc: Y.Doc;
  node: BoardNode;
  /** Read-only rendering for locked nodes and previews. */
  readOnly?: boolean;
  /** Places the caret at the end once the view exists — the in-place editor opens ready to type. */
  focusOnMount?: boolean;
  /** Escape (or the Done button) leaves editing — the card uses it to go back to preview. */
  onExit?: (() => void) | undefined;
  toolbar?: boolean;
  label?: string;
  now?: () => string;
  /**
   * Handed the editor instance once it exists (and `null` on teardown). The board uses it to drive
   * commands from outside the card — the command palette in P6, the tests today.
   */
  onEditorReady?: ((editor: Editor | null) => void) | undefined;
}

interface ToolbarButton {
  id: string;
  label: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

/** The full command set from §5.4, in the order the toolbar shows them. */
export const TOOLBAR_BUTTONS: ToolbarButton[] = [
  {
    id: 'bold',
    label: 'Bold',
    isActive: (editor) => editor.isActive('bold'),
    run: (editor) => void editor.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    label: 'Italic',
    isActive: (editor) => editor.isActive('italic'),
    run: (editor) => void editor.chain().focus().toggleItalic().run(),
  },
  {
    id: 'strike',
    label: 'Strikethrough',
    isActive: (editor) => editor.isActive('strike'),
    run: (editor) => void editor.chain().focus().toggleStrike().run(),
  },
  {
    id: 'code',
    label: 'Inline code',
    isActive: (editor) => editor.isActive('code'),
    run: (editor) => void editor.chain().focus().toggleCode().run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
    run: (editor) => void editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    isActive: (editor) => editor.isActive('heading', { level: 3 }),
    run: (editor) => void editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bulletList',
    label: 'Bullet list',
    isActive: (editor) => editor.isActive('bulletList'),
    run: (editor) => void editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: 'Numbered list',
    isActive: (editor) => editor.isActive('orderedList'),
    run: (editor) => void editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    label: 'Task list',
    isActive: (editor) => editor.isActive('taskList'),
    run: (editor) => void editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'blockquote',
    label: 'Quote',
    isActive: (editor) => editor.isActive('blockquote'),
    run: (editor) => void editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    label: 'Code block',
    isActive: (editor) => editor.isActive('codeBlock'),
    run: (editor) => void editor.chain().focus().toggleCodeBlock().run(),
  },
];

/** Ranking for the mention popup: prefix matches first, then substring, then the rest. */
export function rankMentions(
  candidates: readonly MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...candidates];
  const score = (candidate: MentionCandidate): number => {
    const title = candidate.title.toLowerCase();
    if (title.startsWith(needle)) return 0;
    if (title.includes(needle)) return 1;
    return 2;
  };
  return candidates
    .filter((candidate) => score(candidate) < 2)
    .sort((a, b) => score(a) - score(b) || a.title.localeCompare(b.title));
}

export function RichTextEditor({
  doc,
  node,
  readOnly = false,
  focusOnMount = false,
  onExit,
  toolbar = true,
  label,
  now = () => new Date().toISOString(),
  onEditorReady,
}: RichTextEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [issue, setIssue] = useState<RichTextSizeIssue | null>(null);
  const blockedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fragmentKey =
    typeof node.data['fragmentKey'] === 'string' && node.data['fragmentKey'] !== ''
      ? node.data['fragmentKey']
      : bodyFragmentKey(node.id);

  // One fragment per node, created on first edit. `useMemo` and not render body: `ensureFragment`
  // writes to the document when the key is new.
  const fragment = useMemo(
    () => ensureFragment(doc, fragmentKey, 'local:create'),
    [doc, fragmentKey],
  );

  const nodeId = node.id;
  const plain = typeof node.data['plain'] === 'string' ? node.data['plain'] : '';
  const plainRef = useRef(plain);
  plainRef.current = plain;

  // Read through a ref: the editor is created once per fragment, the callback may change per render.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const flush = useCallback(() => {
    const result = commitRichText(doc, nodeId, fragment, {
      now: now(),
      currentPlain: plainRef.current,
    });
    blockedRef.current = result.issue?.level === 'block';
    setIssue(result.issue);
  }, [doc, fragment, nodeId, now]);

  const mention = useMemo(
    () => ({
      search: (query: string): MentionCandidate[] => {
        const candidates = listNodes(doc)
          .filter((entry) => entry.id !== nodeId)
          .map((entry) => ({
            id: entry.id,
            title: entry.title,
            typeLabel: builtinNodeTypes().get(entry.type).label,
          }));
        return rankMentions(candidates, query);
      },
      exists: (id: string): boolean => listNodes(doc).some((entry) => entry.id === id),
      onAccept: (candidate: MentionCandidate): void => {
        const stamp = now();
        // A mention is a claim about the graph, so it becomes an edge — otherwise the connection
        // would exist only inside a paragraph and never show up in the connections list (§5.4).
        addEdge(
          doc,
          makeEdge(
            { id: newId.board(), from: nodeId, to: candidate.id, type: 'references' },
            stamp,
          ),
          { origin: 'local:edit', now: stamp },
        );
      },
    }),
    [doc, nodeId, now],
  );

  const editor = useEditor(
    {
      editable: !readOnly,
      immediatelyRender: false,
      extensions: richTextExtensions({
        fragment,
        placeholder: 'Write what you found…',
        mention,
        mentionMount: () => containerRef.current,
      }),
      editorProps: {
        attributes: {
          class: 'nx-richtext-surface',
          'aria-label': label ?? 'Note content',
          role: 'textbox',
          'aria-multiline': 'true',
        },
        // The hard cap (§8): once the note is past 200 KB, insertions stop but deleting still
        // works, so the user is never trapped in a document they cannot shrink.
        handleTextInput: () => blockedRef.current,
        handlePaste: () => blockedRef.current,
        // Escape leaves editing. It lives here, not on a wrapper `onKeyDown`, so the surface stays
        // the only interactive element of the component.
        handleKeyDown: (_view, event) => {
          if (event.key !== 'Escape' || onExitRef.current === undefined) return false;
          event.preventDefault();
          flush();
          onExitRef.current();
          return true;
        },
      },
      onUpdate: () => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(flush, PROJECTION_DEBOUNCE_MS);
      },
      onBlur: () => flush(),
    },
    [fragment, readOnly],
  );

  useEffect(() => {
    if (editor !== null && focusOnMount) editor.commands.focus('end');
  }, [editor, focusOnMount]);

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  // Leaving the editor must never lose the last keystrokes of a debounced projection.
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <div
      className="nx-richtext"
      ref={containerRef}
      data-testid={`richtext-${nodeId}`}
      data-readonly={readOnly ? 'true' : undefined}
    >
      {toolbar && !readOnly && editor !== null ? (
        <div className="nx-richtext-toolbar" role="toolbar" aria-label="Formatting">
          {TOOLBAR_BUTTONS.map((button) => (
            <button
              key={button.id}
              type="button"
              className="nx-richtext-tool"
              aria-label={button.label}
              aria-pressed={button.isActive(editor)}
              // mousedown would steal the selection the command needs.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => button.run(editor)}
            >
              {button.label}
            </button>
          ))}
        </div>
      ) : null}

      <EditorContent editor={editor} />

      {issue === null ? null : (
        <p
          className="nx-richtext-issue"
          data-level={issue.level}
          role={issue.level === 'block' ? 'alert' : 'status'}
        >
          {issue.message}
        </p>
      )}
    </div>
  );
}
