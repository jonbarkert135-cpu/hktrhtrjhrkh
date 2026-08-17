import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { createBoardDoc } from '../src/doc/createBoardDoc.ts';
import { ensureFragment } from '../src/doc/mutations.ts';
import { tx } from '../src/doc/transactions.ts';
import {
  applyJsonToFragment,
  fragmentToJson,
  type RichTextDocJson,
} from '../src/export/richtext.ts';
import { T0 } from './doc-fixtures.ts';

const doc = (): Y.Doc => createBoardDoc({ boardId: 'b_rt', now: T0 });

const sample: RichTextDocJson = {
  encoding: 'prosemirror-json',
  doc: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: '2' },
        content: [{ type: 'text', text: 'Findings' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'plain then ' },
          { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
          { type: 'text', text: ' and ', marks: [] },
          {
            type: 'text',
            text: 'linked',
            marks: [{ type: 'link', attrs: { href: 'https://x.test' } }],
          },
        ],
      },
      { type: 'horizontal_rule' },
    ],
  },
};

describe('rich text ↔ ProseMirror JSON', () => {
  it('round-trips blocks, marks and attributes', () => {
    const board = doc();
    const fragment = ensureFragment(board, 'fk_1', 'local:create');
    tx(board, 'local:edit', () => applyJsonToFragment(fragment, sample));

    const json = fragmentToJson(fragment);
    expect(json.doc.content[0]?.type).toBe('heading');
    expect(json.doc.content[0]?.attrs).toEqual({ level: '2' });
    expect(json.doc.content[2]).toEqual({ type: 'horizontal_rule' });

    const marks = json.doc.content[1]?.content?.[1]?.marks;
    expect(marks).toEqual([{ type: 'strong' }]);
    const link = json.doc.content[1]?.content?.[3]?.marks?.[0];
    expect(link?.type).toBe('link');

    // Re-applying the exported JSON reproduces the same fragment.
    const other = ensureFragment(board, 'fk_2', 'local:create');
    tx(board, 'local:edit', () => applyJsonToFragment(other, json));
    expect(fragmentToJson(other)).toEqual(json);
  });

  it('replaces existing content instead of appending', () => {
    const board = doc();
    const fragment = ensureFragment(board, 'fk_1', 'local:create');
    tx(board, 'local:edit', () => applyJsonToFragment(fragment, sample));
    tx(board, 'local:edit', () =>
      applyJsonToFragment(fragment, {
        encoding: 'prosemirror-json',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new' }] }],
        },
      }),
    );
    expect(fragmentToJson(fragment).doc.content).toHaveLength(1);
  });

  it('exports an empty fragment as an empty document', () => {
    const board = doc();
    const fragment = ensureFragment(board, 'fk_empty', 'local:create');
    expect(fragmentToJson(fragment)).toEqual({
      encoding: 'prosemirror-json',
      doc: { type: 'doc', content: [] },
    });
  });
});
