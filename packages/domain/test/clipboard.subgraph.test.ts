import { describe, expect, it } from 'vitest';

import {
  copySubgraph,
  cutSubgraph,
  parseClip,
  REFERENCED_FROM,
  pasteSubgraph,
  serializeClip,
} from '../src/clipboard/subgraph.ts';
import { listEdges, listNodes } from '../src/doc/mutations.ts';
import { T0, fixtureBoard, seqIds } from './doc-fixtures.ts';

const now = '2026-08-22T10:00:00.000Z';

describe('subgraph clipboard', () => {
  it('copies the selected nodes and only the edges between them', () => {
    const { doc, nodeIds } = fixtureBoard(3, 2);
    const clip = copySubgraph(doc, [nodeIds[0] ?? '', nodeIds[1] ?? '']);
    expect(clip.nodes.map((node) => node.id)).toEqual([nodeIds[0], nodeIds[1]]);
    // e_0001 links n1→n2 (kept); e_0002 links n2→n3 (dropped, n3 is not selected).
    expect(clip.edges).toHaveLength(1);
    expect(clip.edges[0]?.id).toBe('e_0001');
  });

  it('ignores ids that are not on the board', () => {
    const { doc, nodeIds } = fixtureBoard(2, 1);
    expect(copySubgraph(doc, [nodeIds[0] ?? '', 'missing']).nodes).toHaveLength(1);
  });

  it('pastes with fresh ids, keeps internal edges and offsets to the target point', () => {
    const { doc, nodeIds } = fixtureBoard(3, 2);
    const clip = copySubgraph(doc, [nodeIds[0] ?? '', nodeIds[1] ?? '']);
    const result = pasteSubgraph(doc, clip, { at: { x: 1000, y: 500 }, now, makeId: seqIds('p_') });

    expect(result.nodeIds).toEqual(['p_0001', 'p_0002']);
    expect(result.edgeIds).toEqual(['p_0003']);
    expect(listNodes(doc)).toHaveLength(5);

    const pasted = listNodes(doc).filter((node) => node.id.startsWith('p_'));
    expect(Math.min(...pasted.map((node) => node.x))).toBe(1000);
    expect(Math.min(...pasted.map((node) => node.y))).toBe(500);
    // The shape survives: the copied edge now joins the two copies, not the originals.
    const edge = listEdges(doc).find((candidate) => candidate.id === 'p_0003');
    expect(edge?.source.nodeId).toBe('p_0001');
    expect(edge?.target.nodeId).toBe('p_0002');
    expect(pasted.every((node) => node.parentId === null)).toBe(true);
    expect(pasted.every((node) => node.createdAt === now)).toBe(true);
  });

  it('keeps titles and payloads of the copied nodes', () => {
    const { doc, nodeIds } = fixtureBoard(2, 0);
    const clip = copySubgraph(doc, [nodeIds[0] ?? '']);
    pasteSubgraph(doc, clip, { at: { x: 0, y: 0 }, now, makeId: seqIds('p_') });
    const copy = listNodes(doc).find((node) => node.id === 'p_0001');
    expect(copy?.title).toBe(`Node ${nodeIds[0] ?? ''}`);
    expect(copy?.data['custom']).toEqual({ keptForwardCompatible: true });
  });

  it('does nothing for an empty clip', () => {
    const { doc } = fixtureBoard(2, 1);
    const result = pasteSubgraph(
      doc,
      { kind: 'nexus/subgraph', version: 1, nodes: [], edges: [] },
      { at: { x: 0, y: 0 }, now },
    );
    expect(result).toEqual({ nodeIds: [], edgeIds: [] });
    expect(listNodes(doc)).toHaveLength(2);
  });

  it('cut removes the nodes and their edges but keeps them in the clip', () => {
    const { doc, nodeIds } = fixtureBoard(3, 2);
    const clip = cutSubgraph(doc, [nodeIds[0] ?? '', nodeIds[1] ?? ''], { now });
    expect(clip.nodes).toHaveLength(2);
    expect(listNodes(doc).map((node) => node.id)).toEqual([nodeIds[2]]);
    expect(listEdges(doc)).toHaveLength(0);
  });

  it('round-trips through text and rejects foreign or broken payloads', () => {
    const { doc, nodeIds } = fixtureBoard(2, 1);
    const clip = copySubgraph(doc, nodeIds);
    const parsed = parseClip(serializeClip(clip));
    expect(parsed?.nodes.map((node) => node.id)).toEqual(nodeIds);
    expect(parseClip('https://example.com')).toBeNull();
    expect(parseClip('{"kind":"nexus/subgraph"')).toBeNull();
    expect(parseClip('{"kind":"nexus/subgraph","nodes":{},"edges":[]}')).toBeNull();
    expect(parseClip('{"kind":"nexus/subgraph","nodes":[{"id":"x"}],"edges":[]}')).toBeNull();
    expect(parseClip(JSON.stringify({ kind: 'other', nodes: [], edges: [] }))).toBeNull();
  });

  it('keeps the original timestamps in the clip itself', () => {
    const { doc, nodeIds } = fixtureBoard(2, 1);
    expect(copySubgraph(doc, nodeIds).nodes[0]?.createdAt).toBe(T0);
  });

  describe('cross-project references (§20)', () => {
    const source = { boardId: 'b_a', projectId: 'p_a', boardTitle: 'Investigation A' };

    it('keeps the origin on a paste into another board', () => {
      const { doc, nodeIds } = fixtureBoard(2, 1);
      const clip = copySubgraph(doc, [nodeIds[0] ?? ''], source);
      pasteSubgraph(doc, clip, {
        at: { x: 10, y: 10 },
        now,
        makeId: seqIds('p_'),
        into: { boardId: 'b_b', projectId: 'p_b' },
      });
      const pasted = listNodes(doc).find((node) => node.id === 'p_0001');
      expect(pasted?.data[REFERENCED_FROM]).toEqual(source);
    });

    it('does not reference the board it was copied from', () => {
      const { doc, nodeIds } = fixtureBoard(2, 1);
      const clip = copySubgraph(doc, [nodeIds[0] ?? ''], source);
      pasteSubgraph(doc, clip, {
        at: { x: 10, y: 10 },
        now,
        makeId: seqIds('p_'),
        into: { boardId: 'b_a', projectId: 'p_a' },
      });
      expect(listNodes(doc).find((node) => node.id === 'p_0001')?.data[REFERENCED_FROM]).toBe(
        undefined,
      );
    });

    it('survives the system clipboard round-trip', () => {
      const { doc, nodeIds } = fixtureBoard(2, 1);
      const clip = copySubgraph(doc, [nodeIds[0] ?? ''], source);
      expect(parseClip(serializeClip(clip))?.source).toEqual(source);
    });

    it('drops a malformed source rather than failing the paste', () => {
      const { doc, nodeIds } = fixtureBoard(2, 1);
      const clip = copySubgraph(doc, [nodeIds[0] ?? '']);
      const text = JSON.stringify({ ...clip, source: { projectId: 'p_a' } });
      const parsed = parseClip(text);
      expect(parsed?.nodes).toHaveLength(1);
      expect(parsed?.source).toBe(undefined);
    });

    it('cut carries the source too', () => {
      const { doc, nodeIds } = fixtureBoard(2, 1);
      expect(cutSubgraph(doc, [nodeIds[0] ?? ''], { now, source }).source).toEqual(source);
    });
  });
});
