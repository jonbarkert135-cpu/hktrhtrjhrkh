/**
 * The editor over a real `Y.XmlFragment` (P4 §5.4–5.5). Every assertion here ends at the document,
 * not at the DOM: the fragment and `data.plain` are what survive a reload, so that is what the
 * tests pin. Editing is driven through the editor instance because ProseMirror owns its DOM and
 * jsdom has no caret.
 */

import {
  addNode,
  createBoardDoc,
  createNode,
  ensureFragment,
  getNode,
  listEdges,
  makeNode,
  richTextProjection,
  type BoardNode,
} from '@nexus/domain';
import type { Editor } from '@tiptap/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';

import { PROJECTION_DEBOUNCE_MS, rankMentions, RichTextEditor } from './RichTextEditor.tsx';

const T0 = '2026-06-01T00:00:00.000Z';

function setup(): { doc: Y.Doc; node: BoardNode } {
  const doc = createBoardDoc({ boardId: 'b_editor', now: T0 });
  const { node } = createNode(
    doc,
    { type: 'note', x: 0, y: 0, title: 'Finding' },
    { now: T0, makeId: () => 'n_note' },
  );
  return { doc, node };
}

const fragmentOf = (doc: Y.Doc, node: BoardNode): Y.XmlFragment =>
  ensureFragment(doc, String(node.data['fragmentKey']), 'local:create');

/** `setContent` is silent by default; the editor's `onUpdate` is what schedules the projection. */
const setContent = (editor: Editor, html: string): void => {
  editor.commands.setContent(html, true);
};

/** Renders the editor and resolves once TipTap has created its view. */
async function mount(
  ui: (onReady: (editor: Editor | null) => void) => React.ReactElement,
): Promise<{ editor: Editor }> {
  let instance: Editor | null = null;
  render(ui((editor) => (instance = editor ?? instance)));
  await screen.findByRole('textbox');
  await waitFor(() => expect(instance).not.toBeNull());
  return { editor: instance as unknown as Editor };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RichTextEditor', () => {
  it('renders the toolbar with the command set the spec lists', async () => {
    const { doc, node } = setup();
    await mount((onReady) => (
      <RichTextEditor doc={doc} node={node} now={() => T0} onEditorReady={onReady} />
    ));

    expect(screen.getByRole('textbox')).toHaveAttribute('aria-multiline', 'true');
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    for (const label of [
      'Bold',
      'Italic',
      'Strikethrough',
      'Inline code',
      'Heading 2',
      'Heading 3',
      'Bullet list',
      'Numbered list',
      'Task list',
      'Quote',
      'Code block',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('writes typed content into the shared fragment and projects it to data.plain', async () => {
    const { doc, node } = setup();
    const { editor } = await mount((onReady) => (
      <RichTextEditor doc={doc} node={node} now={() => T0} onEditorReady={onReady} />
    ));

    act(() => setContent(editor, '<p>k0bra reuses the same avatar</p>'));

    const fragment = fragmentOf(doc, node);
    expect(richTextProjection(fragment).plain).toBe('k0bra reuses the same avatar');
    // The projection is debounced, so the document catches up shortly after the keystroke.
    await waitFor(() =>
      expect(getNode(doc, node.id)?.data['plain']).toBe('k0bra reuses the same avatar'),
    );
  });

  it('flushes the debounced projection while typing continues', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { doc, node } = setup();
    const { editor } = await mount((onReady) => (
      <RichTextEditor doc={doc} node={node} now={() => T0} onEditorReady={onReady} />
    ));

    act(() => setContent(editor, '<p>halfway</p>'));
    expect(getNode(doc, node.id)?.data['plain']).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROJECTION_DEBOUNCE_MS + 10);
    });
    expect(getNode(doc, node.id)?.data['plain']).toBe('halfway');
  });

  it('keeps the block-level structure the spec allows and drops what it does not', async () => {
    const { doc, node } = setup();
    const { editor } = await mount((onReady) => (
      <RichTextEditor doc={doc} node={node} now={() => T0} onEditorReady={onReady} />
    ));

    act(() =>
      setContent(
        editor,
        '<h2>Findings</h2><ul><li>github</li></ul><blockquote>quoted</blockquote>' +
          '<p><img src="https://example.com/a.png" alt="x"><script>alert(1)</script>tail</p>',
      ),
    );

    const plain = richTextProjection(fragmentOf(doc, node)).plain;
    expect(plain).toContain('Findings');
    expect(plain).toContain('github');
    expect(plain).toContain('quoted');
    expect(plain).toContain('tail');
    // Images are nodes on the canvas, and script content has no mark to land on.
    expect(editor.getHTML()).not.toContain('<img');
    expect(editor.getHTML()).not.toContain('script');
  });

  it('refuses new text once the note passes the hard size cap, but still allows deleting', async () => {
    const { doc, node } = setup();
    const { editor } = await mount((onReady) => (
      <RichTextEditor doc={doc} node={node} now={() => T0} onEditorReady={onReady} />
    ));

    act(() => setContent(editor, `<p>${'x'.repeat(210_000)}</p>`));

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveAttribute('data-level', 'block');
    expect(warning.textContent).toContain('the limit is 200 KB');

    // `handleTextInput` returning true is what swallows the keystroke in the browser.
    expect(
      editor.view.someProp('handleTextInput', (fn) =>
        fn(editor.view, 0, 0, 'a', () => editor.state.tr),
      ),
    ).toBe(true);

    act(() => setContent(editor, '<p>short again</p>'));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('warns before the cap without blocking anything', async () => {
    const { doc, node } = setup();
    const { editor } = await mount((onReady) => (
      <RichTextEditor doc={doc} node={node} now={() => T0} onEditorReady={onReady} />
    ));
    act(() => setContent(editor, `<p>${'x'.repeat(160_000)}</p>`));
    const notice = await screen.findByRole('status');
    expect(notice).toHaveAttribute('data-level', 'warn');
    // `someProp` reports the first truthy result, so "not blocked" is the absence of one.
    expect(
      editor.view.someProp('handleTextInput', (fn) =>
        fn(editor.view, 0, 0, 'a', () => editor.state.tr),
      ),
    ).toBeFalsy();
  });

  it('marks a locked node read-only and hides the toolbar', async () => {
    const doc = createBoardDoc({ boardId: 'b_locked', now: T0 });
    const node = {
      ...makeNode({ id: 'n_locked', type: 'note', x: 0, y: 0, w: 200, h: 100 }, T0),
      locked: true,
    };
    addNode(doc, node, { origin: 'local:create', now: T0 });
    render(<RichTextEditor doc={doc} node={node} readOnly now={() => T0} />);

    await screen.findByRole('textbox');
    expect(screen.getByTestId('richtext-n_locked')).toHaveAttribute('data-readonly', 'true');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('leaves editing on Escape and flushes what was typed', async () => {
    const { doc, node } = setup();
    const onExit = vi.fn();
    const { editor } = await mount((onReady) => (
      <RichTextEditor
        doc={doc}
        node={node}
        onExit={onExit}
        now={() => T0}
        onEditorReady={onReady}
      />
    ));

    act(() => setContent(editor, '<p>escaped</p>'));
    act(() => {
      screen
        .getByRole('textbox')
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
    });

    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(getNode(doc, node.id)?.data['plain']).toBe('escaped');
  });

  it('toggles marks from the toolbar and reflects the active state', async () => {
    const { doc, node } = setup();
    const { editor } = await mount((onReady) => (
      <RichTextEditor doc={doc} node={node} now={() => T0} onEditorReady={onReady} />
    ));

    act(() => {
      setContent(editor, '<p>finding</p>');
      editor.commands.selectAll();
    });
    act(() => screen.getByRole('button', { name: 'Bold' }).click());
    expect(editor.getHTML()).toContain('<strong>');

    act(() => screen.getByRole('button', { name: 'Heading 2' }).click());
    expect(editor.getHTML()).toContain('<h2>');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Heading 2' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });

  it('creates a references edge when a mention is accepted', async () => {
    const { doc, node } = setup();
    createNode(
      doc,
      { type: 'person', x: 200, y: 0, title: 'Ada Lovelace' },
      { now: T0, makeId: () => 'n_person' },
    );
    const { editor } = await mount((onReady) => (
      <RichTextEditor doc={doc} node={node} now={() => T0} onEditorReady={onReady} />
    ));

    // What the popup does on accept: insert the mention, then let the handler write the edge.
    const suggestion = editor.extensionManager.extensions.find(
      (extension) => extension.name === 'mention',
    );
    expect(suggestion).toBeDefined();
    const options = suggestion?.options as {
      suggestion: {
        items: (props: { query: string }) => Array<{ id: string; title: string }>;
        command: (props: unknown) => void;
      };
    };

    expect(options.suggestion.items({ query: 'ada' })).toEqual([
      { id: 'n_person', title: 'Ada Lovelace', typeLabel: 'Person' },
    ]);
    // The node itself is never offered as a mention of itself.
    expect(options.suggestion.items({ query: 'finding' })).toEqual([]);

    act(() => {
      options.suggestion.command({
        editor,
        range: { from: 1, to: 1 },
        props: { id: 'n_person', title: 'Ada Lovelace', typeLabel: 'Person' },
      });
    });

    const edges = listEdges(doc);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.type).toBe('references');
    expect(edges[0]?.source.nodeId).toBe('n_note');
    expect(edges[0]?.target.nodeId).toBe('n_person');
    expect(editor.getHTML()).toContain('data-mention-id="n_person"');
  });

  it('renders a mention of a deleted node as "deleted node"', async () => {
    const { doc, node } = setup();
    const { node: person } = createNode(
      doc,
      { type: 'person', x: 200, y: 0, title: 'Ada Lovelace' },
      { now: T0, makeId: () => 'n_person' },
    );
    const { editor } = await mount((onReady) => (
      <RichTextEditor doc={doc} node={node} now={() => T0} onEditorReady={onReady} />
    ));

    act(() =>
      setContent(
        editor,
        '<p><span data-type="mention" data-id="n_person" data-label="Ada Lovelace"></span></p>',
      ),
    );
    expect(editor.getHTML()).toContain('@Ada Lovelace');
    expect(getNode(doc, person.id)).toBeDefined();

    // Delete the target, then force a re-render of the paragraph the way an edit would.
    act(() => {
      doc.getMap('nodes').delete('n_person');
      setContent(editor, editor.getHTML());
    });
    expect(editor.getHTML()).toContain('deleted node');
  });
});

describe('rankMentions', () => {
  const items = [
    { id: 'n1', title: 'Grace Hopper', typeLabel: 'Person' },
    { id: 'n2', title: 'Ada Lovelace', typeLabel: 'Person' },
    { id: 'n3', title: 'lovelace.example.com', typeLabel: 'Website' },
  ];

  it('puts prefix matches before substring matches and drops the rest', () => {
    expect(rankMentions(items, 'lovelace').map((item) => item.id)).toEqual(['n3', 'n2']);
  });

  it('returns everything for an empty query', () => {
    expect(rankMentions(items, '   ')).toHaveLength(3);
  });
});
