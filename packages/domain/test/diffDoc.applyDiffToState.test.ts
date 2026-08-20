/**
 * packages/domain/src/projection/diffDoc.ts — `applyDiffToState`, the state-folding half of the
 * diff/apply cycle exercised end to end (via the store) by `test/projection.diff.test.ts`. This
 * file drives the pure function directly so upsert/delete folding for both nodes and edges is
 * covered without going through Yjs.
 */

import { describe, expect, it } from 'vitest';
import {
  applyDiffToState,
  emptyProjectionState,
  isNewer,
  type ProjectionDiff,
} from '../src/projection/diffDoc.ts';
import type { BoardEdge } from '../src/entities/edge.ts';
import { fixtureNode } from './doc-fixtures.ts';

const node = fixtureNode('n1');

/** applyDiffToState only reads id/version/updatedAt off an edge, so a minimal stub is enough. */
function stubEdge(id: string, version: number, updatedAt: string): BoardEdge {
  return { id, version, updatedAt } as unknown as BoardEdge;
}

const emptyDiff = (): ProjectionDiff => ({
  upsertNodes: [],
  deleteNodeIds: [],
  upsertEdges: [],
  deleteEdgeIds: [],
});

describe('applyDiffToState', () => {
  it('folds an upserted node into the state', () => {
    const state = applyDiffToState(emptyProjectionState(), {
      ...emptyDiff(),
      upsertNodes: [node],
    });
    expect(state.nodes.get('n1')).toEqual({
      id: 'n1',
      version: node.version,
      updatedAt: node.updatedAt,
    });
  });

  it('folds an upserted edge into the state', () => {
    const edge = stubEdge('e1', 2, '2026-01-01T00:00:00.000Z');
    const state = applyDiffToState(emptyProjectionState(), {
      ...emptyDiff(),
      upsertEdges: [edge],
    });
    expect(state.edges.get('e1')).toEqual({ id: 'e1', version: 2, updatedAt: edge.updatedAt });
  });

  it('removes deleted node ids from the state', () => {
    const seeded = applyDiffToState(emptyProjectionState(), {
      ...emptyDiff(),
      upsertNodes: [node],
    });
    const next = applyDiffToState(seeded, { ...emptyDiff(), deleteNodeIds: ['n1'] });
    expect(next.nodes.has('n1')).toBe(false);
  });

  it('removes deleted edge ids from the state', () => {
    const edge = stubEdge('e1', 1, '2026-01-01T00:00:00.000Z');
    const seeded = applyDiffToState(emptyProjectionState(), {
      ...emptyDiff(),
      upsertEdges: [edge],
    });
    const next = applyDiffToState(seeded, { ...emptyDiff(), deleteEdgeIds: ['e1'] });
    expect(next.edges.has('e1')).toBe(false);
  });

  it('does not mutate the prior state (returns fresh maps)', () => {
    const prior = emptyProjectionState();
    const next = applyDiffToState(prior, { ...emptyDiff(), upsertNodes: [node] });
    expect(prior.nodes.size).toBe(0);
    expect(next.nodes.size).toBe(1);
  });

  it('applies upserts and deletes together in one fold', () => {
    const other = fixtureNode('n2', 1);
    const seeded = applyDiffToState(emptyProjectionState(), {
      ...emptyDiff(),
      upsertNodes: [node],
    });
    const next = applyDiffToState(seeded, {
      ...emptyDiff(),
      upsertNodes: [other],
      deleteNodeIds: ['n1'],
    });
    expect([...next.nodes.keys()]).toEqual(['n2']);
  });
});

describe('isNewer', () => {
  it('is newer than nothing prior', () => {
    expect(isNewer(undefined, { version: 1, updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(true);
  });

  it('is newer with a strictly higher version', () => {
    const prior = { id: 'n1', version: 1, updatedAt: '2026-01-01T00:00:00.000Z' };
    expect(isNewer(prior, { version: 2, updatedAt: '2025-01-01T00:00:00.000Z' })).toBe(true);
  });

  it('is newer with the same version and a later updatedAt', () => {
    const prior = { id: 'n1', version: 1, updatedAt: '2026-01-01T00:00:00.000Z' };
    expect(isNewer(prior, { version: 1, updatedAt: '2026-01-02T00:00:00.000Z' })).toBe(true);
  });

  it('is not newer with the same version and the same updatedAt', () => {
    const prior = { id: 'n1', version: 1, updatedAt: '2026-01-01T00:00:00.000Z' };
    expect(isNewer(prior, { version: 1, updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
  });

  it('is not newer with a lower version', () => {
    const prior = { id: 'n1', version: 2, updatedAt: '2020-01-01T00:00:00.000Z' };
    expect(isNewer(prior, { version: 1, updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
  });
});
