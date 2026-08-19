/**
 * Relationship commands (P5 §5.11, §5.12). They write through the domain, so every assertion here
 * reads the *document* back rather than a component's state.
 */

import {
  addEdge,
  createBoardDoc,
  createNode,
  getEdge,
  listEdges,
  makeEdge,
  EDGE_LABEL_MAX,
} from '@nexus/domain';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import {
  deleteEdge,
  reverseEdge,
  setEdgeConfidence,
  setEdgeDirected,
  setEdgeLabel,
  setEdgeRouting,
  setEdgeType,
} from './edgeCommands.ts';

const T0 = '2026-06-01T00:00:00.000Z';

function board(): { doc: Y.Doc; edgeId: string } {
  const doc = createBoardDoc({ boardId: 'b_edges', now: T0 });
  let counter = 0;
  const make = (title: string): string =>
    createNode(
      doc,
      { type: 'note', x: 0, y: 0, title },
      { now: T0, makeId: () => `n_${String(++counter)}` },
    ).node.id;
  const a = make('Alpha');
  const b = make('Beta');
  addEdge(doc, makeEdge({ id: 'e_1', from: a, to: b, type: 'references' }, T0), {
    origin: 'local:create',
    now: T0,
  });
  return { doc, edgeId: 'e_1' };
}

const context = (doc: Y.Doc) => ({ doc, now: () => T0 });

describe('edge commands', () => {
  it('changes the type and adopts the type default direction', () => {
    const { doc, edgeId } = board();
    expect(setEdgeType(context(doc), edgeId, 'same_as').ok).toBe(true);
    const edge = getEdge(doc, edgeId);
    expect(edge?.type).toBe('same_as');
    expect(edge?.directed).toBe(false);
  });

  it('refuses a type change that would duplicate an existing relationship', () => {
    const { doc, edgeId } = board();
    const edge = getEdge(doc, edgeId);
    addEdge(
      doc,
      makeEdge(
        { id: 'e_2', from: edge?.source.nodeId ?? '', to: edge?.target.nodeId ?? '', type: 'owns' },
        T0,
      ),
      { origin: 'local:create', now: T0 },
    );
    const result = setEdgeType(context(doc), edgeId, 'owns');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already connected/i);
    expect(getEdge(doc, edgeId)?.type).toBe('references');
  });

  it('rejects an over-long label and keeps the stored one', () => {
    const { doc, edgeId } = board();
    const result = setEdgeLabel(context(doc), edgeId, 'x'.repeat(EDGE_LABEL_MAX + 1));
    expect(result.ok).toBe(false);
    expect(getEdge(doc, edgeId)?.label).toBe('');
    expect(setEdgeLabel(context(doc), edgeId, 'owns the domain').ok).toBe(true);
    expect(getEdge(doc, edgeId)?.label).toBe('owns the domain');
  });

  it('stores routing, direction and confidence overrides', () => {
    const { doc, edgeId } = board();
    setEdgeRouting(context(doc), edgeId, 'orthogonal');
    setEdgeDirected(context(doc), edgeId, false);
    setEdgeConfidence(context(doc), edgeId, 'high');
    const edge = getEdge(doc, edgeId);
    expect(edge?.style.routing).toBe('orthogonal');
    expect(edge?.directed).toBe(false);
    expect(edge?.confidence).toBe('high');
  });

  it('reverses the endpoints in one transaction', () => {
    const { doc, edgeId } = board();
    const before = getEdge(doc, edgeId);
    expect(reverseEdge(context(doc), edgeId).ok).toBe(true);
    const after = getEdge(doc, edgeId);
    expect(after?.source.nodeId).toBe(before?.target.nodeId);
    expect(after?.target.nodeId).toBe(before?.source.nodeId);
  });

  it('deletes the relationship and reports a second delete plainly', () => {
    const { doc, edgeId } = board();
    expect(deleteEdge(context(doc), edgeId).ok).toBe(true);
    expect(listEdges(doc)).toHaveLength(0);
    expect(deleteEdge(context(doc), edgeId)).toEqual({
      ok: false,
      message: 'This relationship no longer exists.',
    });
  });
});
