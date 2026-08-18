/**
 * Node lifecycle (P4 §5.10 and acceptance criterion 1): create, edit, duplicate, convert, delete —
 * each one transaction, each undoable, and none of them able to make two nodes share one rich-text
 * body.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { createBoardDoc } from '../src/doc/createBoardDoc.ts';
import { getNode, listNodes } from '../src/doc/mutations.ts';
import { boardRoots } from '../src/doc/schema.ts';
import { createBoardHistory } from '../src/history/undoManager.ts';
import { builtinNodeTypes } from '../src/nodes/builtins.ts';
import {
  DUPLICATE_OFFSET,
  bodyFragmentKey,
  convertNode,
  createNode,
  deleteNode,
  duplicateNode,
  planConversion,
  setNodeTags,
  updateNodeData,
} from '../src/nodes/lifecycle.ts';
import type { TypedNode } from '../src/nodes/types.ts';

const T0 = '2026-01-01T00:00:00.000Z';

function makeDoc(name: string): Y.Doc {
  builtinNodeTypes();
  return createBoardDoc({ boardId: name, now: T0 });
}

let counter = 0;
const options = { now: T0, makeId: (): string => `n_${String(++counter)}` };

describe('createNode', () => {
  it('fills registry defaults and mints a rich-text fragment for editable types', () => {
    const doc = makeDoc('b_create');
    const { node } = createNode(doc, { type: 'note', x: 10, y: 20 }, options);

    expect(node.w).toBe(280);
    expect(node.h).toBe(160);
    expect(node.data['severity']).toBe('info');
    expect(node.data['fragmentKey']).toBe(bodyFragmentKey(node.id));
    expect(boardRoots(doc).richtext.get(bodyFragmentKey(node.id))).toBeInstanceOf(Y.XmlFragment);
    expect(node.provenance.kind).toBe('manual');
  });

  it('does not create a fragment for a type without editable text', () => {
    const doc = makeDoc('b_create_website');
    const { node } = createNode(
      doc,
      { type: 'website', x: 0, y: 0, data: { url: 'https://example.com' } },
      options,
    );
    expect(node.data['url']).toBe('https://example.com');
    expect(node.data['status']).toBe('pending');
    expect(boardRoots(doc).richtext.size).toBe(0);
  });

  it('normalises tags and reports the ones it refused', () => {
    const doc = makeDoc('b_create_tags');
    const created = createNode(doc, { type: 'link', x: 0, y: 0, tags: ['a', 'A', '  '] }, options);
    expect(created.node.tags).toEqual(['a']);
    expect(created.rejectedTags.map((entry) => entry.reason)).toEqual(['duplicate', 'empty']);
  });

  it('keeps an unrecognised type and its payload verbatim', () => {
    const doc = makeDoc('b_create_unknown');
    const { node } = createNode(
      doc,
      { type: 'quantum-thing', x: 0, y: 0, data: { anything: [1, 2, 3] } },
      options,
    );
    expect(node.type).toBe('quantum-thing');
    expect(node.data['anything']).toEqual([1, 2, 3]);
  });

  it('accepts explicit provenance from a capture pipeline', () => {
    const doc = makeDoc('b_create_prov');
    const { node } = createNode(
      doc,
      { type: 'link', x: 0, y: 0, provenance: { kind: 'paste', source: 'https://example.com' } },
      { ...options, actorId: 'u_1' },
    );
    expect(node.provenance.kind).toBe('paste');
    expect(node.provenance.source).toBe('https://example.com');
    expect(node.provenance.actorId).toBe('u_1');
  });
});

describe('updateNodeData / setNodeTags', () => {
  it('merges a patch through the type schema', () => {
    const doc = makeDoc('b_update');
    const { node } = createNode(doc, { type: 'website', x: 0, y: 0 }, options);
    expect(updateNodeData(doc, node.id, { status: 'ok', httpStatus: 200 }, options)).toBe(true);
    const updated = getNode(doc, node.id);
    expect(updated?.data['status']).toBe('ok');
    expect(updated?.data['httpStatus']).toBe(200);
    expect(updated?.version).toBe(2);
  });

  it('returns false for a node that is gone', () => {
    const doc = makeDoc('b_update_missing');
    expect(updateNodeData(doc, 'nope', { status: 'ok' }, options)).toBe(false);
    expect(setNodeTags(doc, 'nope', ['x'], options).applied).toBe(false);
  });

  it('replaces the tag set and reports rejections', () => {
    const doc = makeDoc('b_tags');
    const { node } = createNode(doc, { type: 'note', x: 0, y: 0 }, options);
    const result = setNodeTags(doc, node.id, ['red', 'RED', 'blue'], options);
    expect(result.applied).toBe(true);
    expect(result.tags).toEqual(['red', 'blue']);
    expect(result.rejected).toHaveLength(1);
    expect(getNode(doc, node.id)?.tags).toEqual(['red', 'blue']);
  });
});

describe('duplicateNode', () => {
  it('offsets the copy, mints new ids and records what it came from', () => {
    const doc = makeDoc('b_dupe');
    const { node } = createNode(doc, { type: 'note', x: 100, y: 50, title: 'Finding' }, options);
    const copy = duplicateNode(doc, node.id, options);

    expect(copy).toBeDefined();
    expect(copy?.id).not.toBe(node.id);
    expect(copy?.x).toBe(100 + DUPLICATE_OFFSET);
    expect(copy?.y).toBe(50 + DUPLICATE_OFFSET);
    expect(copy?.title).toBe('Finding');
    expect(copy?.provenance['derivedFrom']).toBe(node.id);
  });

  it('gives the copy its own rich-text fragment', () => {
    const doc = makeDoc('b_dupe_fragment');
    const { node } = createNode(doc, { type: 'text', x: 0, y: 0 }, options);
    const copy = duplicateNode(doc, node.id, options);
    expect(copy?.data['fragmentKey']).toBe(bodyFragmentKey(copy?.id ?? ''));
    expect(copy?.data['fragmentKey']).not.toBe(node.data['fragmentKey']);
    expect(boardRoots(doc).richtext.size).toBe(2);
  });

  it('returns undefined for a missing node', () => {
    const doc = makeDoc('b_dupe_missing');
    expect(duplicateNode(doc, 'nope', options)).toBeUndefined();
  });
});

describe('deleteNode', () => {
  it('removes the node and is undoable as one step', () => {
    const doc = makeDoc('b_delete');
    const { node } = createNode(doc, { type: 'link', x: 0, y: 0 }, options);
    const history = createBoardHistory(doc, { captureTimeout: 0 });

    expect(deleteNode(doc, node.id, options)).toBe(true);
    expect(listNodes(doc)).toHaveLength(0);

    history.undo();
    expect(listNodes(doc)).toHaveLength(1);
    history.destroy();
  });

  it('returns false when there is nothing to delete', () => {
    const doc = makeDoc('b_delete_missing');
    expect(deleteNode(doc, 'nope', options)).toBe(false);
  });
});

describe('conversion', () => {
  it('plans the conversion and names the payload it would drop', () => {
    const doc = makeDoc('b_convert_plan');
    const { node } = createNode(
      doc,
      {
        type: 'website',
        x: 0,
        y: 0,
        data: { url: 'https://example.com', description: 'A page', httpStatus: 200 },
      },
      options,
    );
    const plan = planConversion(
      getNode(doc, node.id) as TypedNode<Record<string, unknown>>,
      'link',
    );

    expect(plan.data['url']).toBe('https://example.com');
    expect(plan.droppedKeys).toContain('description');
    expect(plan.droppedKeys).toContain('httpStatus');
  });

  it('converts in place, keeping the id and the tags', () => {
    const doc = makeDoc('b_convert');
    const { node } = createNode(
      doc,
      { type: 'link', x: 0, y: 0, tags: ['saved'], data: { url: 'https://example.com' } },
      options,
    );
    expect(convertNode(doc, node.id, 'website', options)).toBe(true);

    const converted = getNode(doc, node.id);
    expect(converted?.type).toBe('website');
    expect(converted?.data['url']).toBe('https://example.com');
    expect(converted?.data['status']).toBe('pending');
    expect(converted?.tags).toEqual(['saved']);
  });

  it('mints a fragment when converting into an editable type', () => {
    const doc = makeDoc('b_convert_text');
    const { node } = createNode(doc, { type: 'link', x: 0, y: 0 }, options);
    expect(convertNode(doc, node.id, 'note', options)).toBe(true);
    expect(getNode(doc, node.id)?.data['fragmentKey']).toBe(bodyFragmentKey(node.id));
    expect(boardRoots(doc).richtext.get(bodyFragmentKey(node.id))).toBeInstanceOf(Y.XmlFragment);
  });

  it('returns false for a missing node', () => {
    const doc = makeDoc('b_convert_missing');
    expect(convertNode(doc, 'nope', 'note', options)).toBe(false);
  });
});
