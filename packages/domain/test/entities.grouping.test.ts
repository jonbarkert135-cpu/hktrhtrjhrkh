import { describe, expect, it } from 'vitest';

import { getNode, listGroups } from '../src/doc/mutations.ts';
import { groupOf, groupSelection, ungroup } from '../src/entities/grouping.ts';
import { fixtureBoard, seqIds } from './doc-fixtures.ts';

const now = '2026-08-22T10:00:00.000Z';

describe('grouping a selection', () => {
  it('wraps the selected nodes in a padded frame and adopts them', () => {
    const { doc, nodeIds } = fixtureBoard(3, 0);
    const group = groupSelection(doc, nodeIds, { now, makeId: seqIds('g_'), label: 'Case A' });

    expect(group?.id).toBe('g_0001');
    expect(group?.label).toBe('Case A');
    expect(group?.childIds).toEqual(nodeIds);
    // Nodes sit at (0,0), (40,25), (80,50) with 280×160 boxes; padding is 24.
    expect(group?.x).toBe(-24);
    expect(group?.y).toBe(-24);
    expect(group?.w).toBe(80 + 280 + 48);
    expect(group?.h).toBe(50 + 160 + 48);
    expect(getNode(doc, nodeIds[0] ?? '')?.parentId).toBe('g_0001');
    expect(listGroups(doc)).toHaveLength(1);
  });

  it('refuses a selection of fewer than two live nodes', () => {
    const { doc, nodeIds } = fixtureBoard(2, 0);
    expect(groupSelection(doc, [nodeIds[0] ?? ''], { now })).toBeNull();
    expect(groupSelection(doc, [nodeIds[0] ?? '', 'missing'], { now })).toBeNull();
    expect(listGroups(doc)).toHaveLength(0);
  });

  it('ungroups, keeping the children and clearing their parent', () => {
    const { doc, nodeIds } = fixtureBoard(2, 0);
    const group = groupSelection(doc, nodeIds, { now, makeId: seqIds('g_') });
    expect(groupOf(doc, nodeIds[0] ?? '')?.id).toBe(group?.id);

    expect(ungroup(doc, group?.id ?? '', { now })).toBe(true);
    expect(listGroups(doc)).toHaveLength(0);
    expect(getNode(doc, nodeIds[0] ?? '')?.parentId).toBeNull();
    expect(ungroup(doc, 'missing', { now })).toBe(false);
    expect(groupOf(doc, nodeIds[0] ?? '')).toBeUndefined();
  });
});
