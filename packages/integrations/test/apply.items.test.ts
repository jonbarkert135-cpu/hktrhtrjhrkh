/** Stage 8 branches the property test does not reach: enrich, conflicts, skips, grid placement. */

import { describe, expect, it } from 'vitest';
import { addNodes, createBoardDoc, getNode, makeNode, newId } from '@nexus/domain';

import { applyProposal, radialPosition } from '../src/apply.ts';
import { IDENTITY_KEY_PROP, PROVENANCE_PROP } from '../src/resolve/identity.ts';
import type { ImportProposal, ProposalItem, Provenance } from '../src/pipeline.ts';

const NOW = '2026-02-01T00:00:00.000Z';
const LATER = '2026-02-02T00:00:00.000Z';

const provenance: Provenance = {
  source: 'test',
  tool: 'expand-url',
  toolVersion: '1.0.0',
  runId: 'run-1',
  observedAt: NOW,
  importedAt: NOW,
  confidence: 0.9,
  actorUserId: 'user-1',
};

function proposalOf(items: readonly ProposalItem[]): ImportProposal {
  return {
    id: 'p1',
    runId: 'run-1',
    integrationId: 'expand-url',
    boardId: 'board-1',
    createdAt: NOW,
    summary: {
      newNodes: items.filter((i) => i.kind === 'new_node').length,
      newEdges: items.filter((i) => i.kind === 'new_edge').length,
      enriched: items.filter((i) => i.kind === 'enrich').length,
      conflicts: items.filter((i) => i.kind === 'conflict').length,
      skippedDuplicates: 0,
    },
    items,
    issues: [],
    expiresAt: LATER,
  };
}

function nodeItem(tempId: string, over: Partial<Provenance> = {}): ProposalItem {
  return {
    id: tempId,
    kind: 'new_node',
    selectedByDefault: true,
    confidence: 0.9,
    explain: 'x',
    node: {
      tempId,
      identityKey: `url:https://${tempId}.test/`,
      nodeType: 'link',
      title: tempId,
      props: { url: `https://${tempId}.test/` },
      tags: ['t'],
      provenance: { ...provenance, ...over },
    },
  };
}

function boardWithNode(id: string, data: Record<string, unknown>) {
  const doc = createBoardDoc({ boardId: 'board-1', title: 'test', now: NOW });
  addNodes(doc, [makeNode({ id, type: 'link', x: 0, y: 0, title: 'existing', data }, NOW)], {
    origin: 'local:edit',
    now: NOW,
  });
  return doc;
}

const baseOptions = {
  conflictResolutions: {},
  placement: 'radial' as const,
  newId: () => newId.board(),
  now: NOW,
};

describe('radialPosition', () => {
  it('places by ring radius and angular slot', () => {
    const p = radialPosition({ x: 0, y: 0 }, 1, 0, 4);
    expect(p).toEqual({ x: 320, y: 0 });
    expect(radialPosition({ x: 10, y: 10 }, 2, 3, 12).y).toBeGreaterThan(10);
  });
});

describe('applyProposal', () => {
  it('refuses items without provenance', () => {
    const doc = createBoardDoc({ boardId: 'board-1', title: 'test', now: NOW });
    const proposal = proposalOf([nodeItem('a', { runId: '' })]);
    expect(() => applyProposal(doc, proposal, { ...baseOptions, selectedItemIds: ['a'] })).toThrow(
      /PROVENANCE_MISSING/,
    );
  });

  it('ignores unselected and already-applied items and grids when asked', () => {
    const doc = createBoardDoc({ boardId: 'board-1', title: 'test', now: NOW });
    const proposal = proposalOf([nodeItem('a'), nodeItem('b'), nodeItem('c')]);
    const result = applyProposal(doc, proposal, {
      ...baseOptions,
      placement: 'grid',
      selectedItemIds: ['a', 'b'],
      alreadyApplied: { b: 'node-b' },
    });
    expect(result.createdNodeIds).toHaveLength(1);
    expect(result.tempIdMap.b).toBe('node-b');
    expect(result.label).toMatch(/Import from expand-url \(1 items\)/);
    const node = getNode(doc, result.createdNodeIds[0] ?? '');
    expect(node?.data[IDENTITY_KEY_PROP]).toBe('url:https://a.test/');
    expect(node?.data[PROVENANCE_PROP]).toHaveLength(1);
  });

  it('skips an edge whose endpoints are missing', () => {
    const doc = createBoardDoc({ boardId: 'board-1', title: 'test', now: NOW });
    const proposal = proposalOf([
      {
        id: 'e1',
        kind: 'new_edge',
        selectedByDefault: true,
        confidence: 0.9,
        explain: 'x',
        edge: {
          tempId: 'e1',
          fromRef: { kind: 'existing', nodeId: 'ghost' },
          toRef: { kind: 'temp', tempId: 'nope' },
          edgeType: 'related_to',
          props: {},
          provenance,
        },
      },
    ]);
    const result = applyProposal(doc, proposal, { ...baseOptions, selectedItemIds: ['e1'] });
    expect(result.createdEdgeIds).toEqual([]);
    expect(result.skipped).toEqual([{ itemId: 'e1', reason: 'target_missing' }]);
  });

  it('applies enrichment patches, including addToSet de-duplication', () => {
    const doc = boardWithNode('node-1', { tags: ['a'] });
    const proposal = proposalOf([
      {
        id: 'p:node-1',
        kind: 'enrich',
        selectedByDefault: true,
        confidence: 0.9,
        explain: 'x',
        targetNodeId: 'node-1',
        provenance,
        fieldPatches: [
          { path: '/url', op: 'set', value: 'https://a.test/' },
          { path: '/tags', op: 'addToSet', value: 'a' },
          { path: '/tags', op: 'addToSet', value: 'b' },
          { path: '/notes', op: 'append', value: 'n1' },
        ],
      },
    ]);
    const result = applyProposal(doc, proposal, { ...baseOptions, selectedItemIds: ['p:node-1'] });
    expect(result.patchedNodeIds).toEqual(['node-1']);
    const data = getNode(doc, 'node-1')?.data ?? {};
    expect(data).toMatchObject({
      url: 'https://a.test/',
      tags: ['a', 'b'],
      notes: ['n1'],
    });
    expect(data[PROVENANCE_PROP]).toHaveLength(1);
  });

  it('honours keep / replace / keep_both conflict resolutions', () => {
    const doc = boardWithNode('node-1', { status: 404, other: 'x' });
    const conflict = (id: string, field: string, resolution: 'keep' | 'replace' | 'keep_both') =>
      ({
        id,
        kind: 'conflict',
        selectedByDefault: false,
        confidence: 0.9,
        explain: 'x',
        targetNodeId: 'node-1',
        field,
        currentValue: 404,
        incomingValue: 200,
        incomingProvenance: provenance,
        resolution,
      }) satisfies ProposalItem;

    const proposal = proposalOf([
      conflict('c1', 'status', 'replace'),
      conflict('c2', 'other', 'keep'),
      conflict('c3', 'both', 'keep_both'),
      conflict('c4', 'status', 'keep'),
    ]);
    const result = applyProposal(doc, proposal, {
      ...baseOptions,
      selectedItemIds: ['c1', 'c2', 'c3', 'c4'],
      conflictResolutions: { c4: 'keep' },
    });
    expect(result.skipped.map((s) => s.itemId).sort()).toEqual(['c2', 'c4']);
    expect(getNode(doc, 'node-1')?.data).toMatchObject({ status: 200, other: 'x', both: [200] });
  });

  it('reports a missing target for enrich and conflict items', () => {
    const doc = createBoardDoc({ boardId: 'board-1', title: 'test', now: NOW });
    const proposal = proposalOf([
      {
        id: 'p:ghost',
        kind: 'enrich',
        selectedByDefault: true,
        confidence: 0.9,
        explain: 'x',
        targetNodeId: 'ghost',
        provenance,
        fieldPatches: [{ path: '/url', op: 'set', value: 'x' }],
      },
      {
        id: 'c:ghost',
        kind: 'conflict',
        selectedByDefault: false,
        confidence: 0.9,
        explain: 'x',
        targetNodeId: 'ghost',
        field: 'url',
        currentValue: 'a',
        incomingValue: 'b',
        incomingProvenance: provenance,
        resolution: 'replace',
      },
    ]);
    const result = applyProposal(doc, proposal, {
      ...baseOptions,
      selectedItemIds: ['p:ghost', 'c:ghost'],
    });
    expect(result.skipped).toEqual([
      { itemId: 'p:ghost', reason: 'target_missing' },
      { itemId: 'c:ghost', reason: 'target_missing' },
    ]);
    expect(result.patchedNodeIds).toEqual([]);
  });

  it('centres the radial layout on the anchor node when it exists', () => {
    const doc = boardWithNode('anchor', {});
    const item = nodeItem('a');
    const anchored: ProposalItem = {
      ...item,
      node: {
        ...(item as Extract<ProposalItem, { kind: 'new_node' }>).node,
        layoutHint: { anchorNodeId: 'anchor', ring: 1, index: 0 },
      },
    } as ProposalItem;
    const result = applyProposal(doc, proposalOf([anchored]), {
      ...baseOptions,
      selectedItemIds: ['a'],
    });
    const created = getNode(doc, result.createdNodeIds[0] ?? '');
    expect(created?.x).toBeGreaterThan(0);
  });
});
