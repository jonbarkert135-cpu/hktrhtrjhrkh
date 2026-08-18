/**
 * `data.plain` is what the card, the L1 painter and (from P7) search read. These tests pin the two
 * properties that make it trustworthy: it follows the fragment exactly, and it is written only
 * when it actually changed — an editor that merely moved the caret must not touch the document.
 */

import {
  applyJsonToFragment,
  createBoardDoc,
  createNode,
  ensureFragment,
  getNode,
  tx,
  type RichTextDocJson,
} from '@nexus/domain';
import { describe, expect, it } from 'vitest';

import { commitRichText } from './projection.ts';

const T0 = '2026-06-01T00:00:00.000Z';

const docWithNote = () => {
  const doc = createBoardDoc({ boardId: 'b_rt', now: T0 });
  const { node } = createNode(doc, { type: 'note', x: 0, y: 0 }, { now: T0 });
  const key = typeof node.data['fragmentKey'] === 'string' ? node.data['fragmentKey'] : '';
  return { doc, node, fragment: ensureFragment(doc, key, 'local:create') };
};

const write = (json: RichTextDocJson['doc']['content']) => ({
  encoding: 'prosemirror-json' as const,
  doc: { type: 'doc' as const, content: json },
});

describe('commitRichText', () => {
  it('writes the plain-text projection of the fragment onto the node', () => {
    const { doc, node, fragment } = docWithNote();
    tx(doc, 'local:edit', () =>
      applyJsonToFragment(
        fragment,
        write([
          { type: 'paragraph', content: [{ type: 'text', text: 'k0bra reuses the same avatar' }] },
        ]),
      ),
    );

    const result = commitRichText(doc, node.id, fragment, { now: T0, currentPlain: '' });
    expect(result.written).toBe(true);
    expect(result.plain).toBe('k0bra reuses the same avatar');
    expect(getNode(doc, node.id)?.data['plain']).toBe('k0bra reuses the same avatar');
    expect(result.issue).toBeNull();
  });

  it('does not touch the document when the projection is unchanged', () => {
    const { doc, node, fragment } = docWithNote();
    tx(doc, 'local:edit', () =>
      applyJsonToFragment(
        fragment,
        write([{ type: 'paragraph', content: [{ type: 'text', text: 'same' }] }]),
      ),
    );
    commitRichText(doc, node.id, fragment, { now: T0, currentPlain: '' });
    const version = getNode(doc, node.id)?.version;

    const again = commitRichText(doc, node.id, fragment, { now: T0, currentPlain: 'same' });
    expect(again.written).toBe(false);
    expect(getNode(doc, node.id)?.version).toBe(version);
  });

  it('reports the size guard so the editor can warn and then refuse', () => {
    const { doc, node, fragment } = docWithNote();
    const long = 'x'.repeat(160_000);
    tx(doc, 'local:edit', () =>
      applyJsonToFragment(
        fragment,
        write([{ type: 'paragraph', content: [{ type: 'text', text: long }] }]),
      ),
    );
    expect(commitRichText(doc, node.id, fragment, { now: T0, currentPlain: '' }).issue?.level).toBe(
      'warn',
    );

    tx(doc, 'local:edit', () =>
      applyJsonToFragment(
        fragment,
        write([{ type: 'paragraph', content: [{ type: 'text', text: 'y'.repeat(210_000) }] }]),
      ),
    );
    const blocked = commitRichText(doc, node.id, fragment, { now: T0, currentPlain: '' });
    expect(blocked.issue?.level).toBe('block');
    // The preview stays capped even though the body is far longer.
    expect(blocked.plain.length).toBe(20_000);
  });

  it('reports nothing written for a node that no longer exists', () => {
    const { doc, fragment } = docWithNote();
    const result = commitRichText(doc, 'n_missing', fragment, { now: T0, currentPlain: 'x' });
    expect(result.written).toBe(false);
  });
});
