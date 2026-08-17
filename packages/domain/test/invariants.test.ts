import { describe, expect, it } from 'vitest';

import { checkGraphInvariants } from '../src/doc/invariants.ts';
import { addGroup, addNodes } from '../src/doc/mutations.ts';
import { boardRoots } from '../src/doc/schema.ts';
import { makeGroup } from '../src/entities/group.ts';
import { T0, fixtureBoard, fixtureNode } from './doc-fixtures.ts';

describe('graph invariants', () => {
  it('accepts a well-formed board', () => {
    const { doc } = fixtureBoard(3, 2);
    expect(checkGraphInvariants(doc)).toEqual([]);
  });

  it('detects dangling edges', () => {
    const { doc, nodeIds } = fixtureBoard(3, 2);
    doc.transact(() => boardRoots(doc).nodes.delete(nodeIds[0] ?? ''));
    const codes = checkGraphInvariants(doc).map((violation) => violation.code);
    expect(codes).toContain('dangling-edge');
    expect(codes).toContain('order-mismatch');
  });

  it('detects missing parents, provenance and fragments', () => {
    const { doc } = fixtureBoard(1, 0);
    const roots = boardRoots(doc);
    doc.transact(() => {
      const node = roots.nodes.values().next().value;
      node?.set('parentId', 'g_missing');
      node?.delete('provenance');
      node?.set('data', { fragmentKey: 'fk_missing' });
    });
    const codes = checkGraphInvariants(doc).map((violation) => violation.code);
    expect(codes).toEqual(
      expect.arrayContaining(['missing-parent', 'missing-provenance', 'missing-fragment']),
    );
  });

  it('detects asymmetric group membership', () => {
    const { doc } = fixtureBoard(1, 0);
    addNodes(doc, [fixtureNode('n_outside', 9)], { origin: 'local:create', now: T0 });
    addGroup(doc, makeGroup({ id: 'g1', x: 0, y: 0, w: 10, h: 10 }, T0), {
      origin: 'local:create',
      now: T0,
    });
    doc.transact(() => boardRoots(doc).groups.get('g1')?.set('childIds', ['n_outside', 42]));
    const violations = checkGraphInvariants(doc);
    expect(violations.filter((v) => v.code === 'asymmetric-group')).toHaveLength(1);
  });

  it('detects duplicated ids in the order array', () => {
    const { doc, nodeIds } = fixtureBoard(2, 0);
    doc.transact(() => boardRoots(doc).order.push([nodeIds[0] ?? '']));
    expect(checkGraphInvariants(doc).map((v) => v.detail)).toContain('duplicated in order');
  });
});
