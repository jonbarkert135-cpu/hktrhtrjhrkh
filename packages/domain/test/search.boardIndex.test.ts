import { describe, expect, it } from 'vitest';

import { indexedDocsForBoard } from '../src/search/boardIndex.ts';
import { createLocalIndex } from '../src/search/localIndex.ts';
import { fixtureBoard } from './doc-fixtures.ts';

describe('indexedDocsForBoard', () => {
  it("produces one IndexedDoc per node, using each type's searchFields()", () => {
    const { doc, nodeIds } = fixtureBoard(3, 0);
    const docs = indexedDocsForBoard(doc, 'board-1');

    expect(docs).toHaveLength(3);
    expect(docs.map((d) => d.id).sort()).toEqual([...nodeIds].sort());
    for (const d of docs) expect(d.boardId).toBe('board-1');
    // fixtureNode titles are `Node <id>`; note/website searchFields both surface the title.
    expect(docs.some((d) => d.title.includes('Node'))).toBe(true);
  });

  it('feeds straight into the local index and is searchable', () => {
    const { doc } = fixtureBoard(3, 0);
    const index = createLocalIndex();
    for (const d of indexedDocsForBoard(doc, 'board-1')) index.upsert(d);

    expect(index.size).toBe(3);
    expect(index.search('node').length).toBeGreaterThan(0);
  });
});
