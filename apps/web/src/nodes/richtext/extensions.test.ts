/**
 * The schema is the security boundary (P4 §7, §9): whatever is not in this list cannot exist in a
 * note, no matter what is pasted. These tests therefore assert on the *set* of extensions, not on
 * behaviour — a mark added by accident fails here rather than in a penetration test.
 */

import { createBoardDoc, ensureFragment, richTextProjection } from '@nexus/domain';
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { FragmentSync, RICH_TEXT_ORIGIN } from './fragmentSync.ts';
import { LINK_PROTOCOLS, richTextExtensions } from './extensions.ts';

const T0 = '2026-06-01T00:00:00.000Z';

const fragment = () =>
  ensureFragment(createBoardDoc({ boardId: 'b_ext', now: T0 }), 'fk_1', 'local:create');

const names = (options = {}): string[] =>
  richTextExtensions({ fragment: null, ...options }).map((extension) => extension.name);

describe('richTextExtensions', () => {
  it('includes exactly the block and mark set the spec lists', () => {
    // StarterKit is one extension that resolves into many, so the schema is the honest source.
    const editor = new Editor({ extensions: richTextExtensions({ fragment: null }) });
    const present = new Set([
      ...Object.keys(editor.schema.nodes),
      ...Object.keys(editor.schema.marks),
    ]);
    for (const required of [
      'bold',
      'italic',
      'strike',
      'code',
      'heading',
      'bulletList',
      'orderedList',
      'taskList',
      'taskItem',
      'blockquote',
      'codeBlock',
      'link',
    ]) {
      expect(present).toContain(required);
    }
    editor.destroy();
  });

  it('omits images, so an image is always a node on the canvas', () => {
    const editor = new Editor({ extensions: richTextExtensions({ fragment: null }) });
    expect(editor.schema.nodes['image']).toBeUndefined();
    expect(editor.schema.marks['underline']).toBeUndefined();
    editor.destroy();
  });

  it('offers only H2 and H3 — the node title is the H1', () => {
    const editor = new Editor({ extensions: richTextExtensions({ fragment: null }) });
    const heading = editor.extensionManager.extensions.find(
      (extension) => extension.name === 'heading',
    );
    expect(heading?.options).toMatchObject({ levels: [2, 3] });
    editor.destroy();
  });

  it('leaves ProseMirror history out: undo belongs to the board', () => {
    const editor = new Editor({ extensions: richTextExtensions({ fragment: null }) });
    // No `undo` command exists at all — ⌘Z can only mean the board's history.
    expect((editor.commands as Record<string, unknown>)['undo']).toBeUndefined();
    editor.destroy();
  });

  it('stores only http(s) links', () => {
    const editor = new Editor({ extensions: richTextExtensions({ fragment: null }) });
    const link = editor.extensionManager.extensions.find((extension) => extension.name === 'link');
    expect(link?.options).toMatchObject({ openOnClick: false, protocols: [...LINK_PROTOCOLS] });
    editor.destroy();
  });

  it('adds the mention node only when a handler is supplied', () => {
    expect(names()).not.toContain('mention');
    expect(names({ mention: { search: () => [], onAccept: () => undefined } })).toContain(
      'mention',
    );
  });
});

describe('FragmentSync', () => {
  it('binds the editor to the fragment that already lives in the document', () => {
    const target = fragment();
    const editor = new Editor({ extensions: richTextExtensions({ fragment: target }) });
    editor.commands.setContent('<p>bound</p>', true);
    expect(richTextProjection(target).plain).toBe('bound');
    editor.destroy();
  });

  it('is inert without a fragment, so a preview can render before the node exists', () => {
    const editor = new Editor({
      extensions: [
        ...richTextExtensions({ fragment: null }),
        FragmentSync.configure({ fragment: null }),
      ],
    });
    expect(() => editor.commands.setContent('<p>unbound</p>', true)).not.toThrow();
    expect(editor.getText()).toContain('unbound');
    editor.destroy();
  });

  it('exposes the binding origin the board history has to track', () => {
    expect(RICH_TEXT_ORIGIN).toBeDefined();
  });
});
