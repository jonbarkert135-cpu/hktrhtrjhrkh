import { describe, expect, it } from 'vitest';

import { createLocalIndex, type IndexedDoc } from '../src/search/localIndex.ts';
import { boundedLevenshtein, matchToken } from '../src/search/score.ts';
import { tokenize, uniqueTokens } from '../src/search/tokenize.ts';

const doc = (over: Partial<IndexedDoc> & Pick<IndexedDoc, 'id'>): IndexedDoc => ({
  boardId: 'board-1',
  title: '',
  body: '',
  keywords: [],
  ...over,
});

describe('tokenize', () => {
  it('lower-cases and splits on non-alphanumerics', () => {
    expect(tokenize("O'Brien, CEO of Acme-Corp!")).toEqual([
      'o',
      'brien',
      'ceo',
      'of',
      'acme',
      'corp',
    ]);
  });

  it('dedupes while preserving first-seen order', () => {
    expect(uniqueTokens('acme acme corp')).toEqual(['acme', 'corp']);
  });
});

describe('boundedLevenshtein', () => {
  it('is 0 for identical strings and short-circuits on length gap', () => {
    expect(boundedLevenshtein('acme', 'acme', 1)).toBe(0);
    expect(boundedLevenshtein('acme', 'a', 1)).toBe(2);
  });

  it('finds a single-edit distance', () => {
    expect(boundedLevenshtein('acme', 'acne', 1)).toBe(1);
    expect(boundedLevenshtein('acme', 'acm', 1)).toBe(1);
  });
});

describe('matchToken', () => {
  it('matches exact, prefix and (for 4+ char terms) fuzzy', () => {
    expect(matchToken('acme', 'acme')).toBe('exact');
    expect(matchToken('ac', 'acme')).toBe('prefix');
    expect(matchToken('acme', 'acne')).toBe('fuzzy');
  });

  it('never fuzzes a short term', () => {
    expect(matchToken('cat', 'cot')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(matchToken('zzz', 'acme')).toBeNull();
  });
});

describe('createLocalIndex', () => {
  it('finds an exact title match', () => {
    const index = createLocalIndex();
    index.upsert(doc({ id: 'n1', title: 'Acme Corp' }));
    index.upsert(doc({ id: 'n2', title: 'Globex Inc' }));

    const results = index.search('acme');
    expect(results.map((r) => r.id)).toEqual(['n1']);
  });

  it('supports prefix matching', () => {
    const index = createLocalIndex();
    index.upsert(doc({ id: 'n1', title: 'Investigation' }));
    expect(index.search('invest').map((r) => r.id)).toEqual(['n1']);
  });

  it('supports fuzzy matching within one edit for terms of 4+ chars', () => {
    const index = createLocalIndex();
    index.upsert(doc({ id: 'n1', title: 'Acme' }));
    expect(index.search('acne').map((r) => r.id)).toEqual(['n1']);
    // two edits away — out of range
    expect(index.search('axxe').map((r) => r.id)).toEqual([]);
  });

  it('ranks title matches above body-only matches', () => {
    const index = createLocalIndex();
    index.upsert(doc({ id: 'body-only', title: 'Unrelated', body: 'mentions acme in passing' }));
    index.upsert(doc({ id: 'title-match', title: 'Acme Corp' }));

    const results = index.search('acme');
    expect(results.map((r) => r.id)).toEqual(['title-match', 'body-only']);
  });

  it('requires every query term to match (AND semantics)', () => {
    const index = createLocalIndex();
    index.upsert(doc({ id: 'n1', title: 'Acme Corp' }));
    index.upsert(doc({ id: 'n2', title: 'Acme Industries' }));

    expect(index.search('acme corp').map((r) => r.id)).toEqual(['n1']);
  });

  it('matches on keywords', () => {
    const index = createLocalIndex();
    index.upsert(doc({ id: 'n1', title: 'Contact', keywords: ['osint', 'darkweb'] }));
    expect(index.search('darkweb').map((r) => r.id)).toEqual(['n1']);
  });

  it("is incremental: upsert replaces a document's postings, remove clears them", () => {
    const index = createLocalIndex();
    index.upsert(doc({ id: 'n1', title: 'Acme Corp' }));
    expect(index.search('acme')).toHaveLength(1);

    index.upsert(doc({ id: 'n1', title: 'Renamed Co' }));
    expect(index.search('acme')).toHaveLength(0);
    expect(index.search('renamed')).toHaveLength(1);

    index.remove('n1');
    expect(index.search('renamed')).toHaveLength(0);
    expect(index.size).toBe(0);
  });

  it('scopes results to one board when asked', () => {
    const index = createLocalIndex();
    index.upsert(doc({ id: 'n1', boardId: 'a', title: 'Acme' }));
    index.upsert(doc({ id: 'n2', boardId: 'b', title: 'Acme' }));

    expect(index.search('acme', { boardId: 'a' }).map((r) => r.id)).toEqual(['n1']);
  });

  it('respects the result limit', () => {
    const index = createLocalIndex();
    for (let i = 0; i < 10; i += 1) index.upsert(doc({ id: `n${String(i)}`, title: 'Acme' }));
    expect(index.search('acme', { limit: 3 })).toHaveLength(3);
  });

  it('builds and searches a 5,000-node index within a generous time budget', () => {
    const index = createLocalIndex();
    const buildStarted = performance.now();
    for (let i = 0; i < 5000; i += 1) {
      index.upsert(
        doc({
          id: `n${String(i)}`,
          title: i === 2500 ? 'Special Investigation Target' : `Node number ${String(i)}`,
          body: 'some shared filler body text repeated across nodes',
          keywords: ['osint'],
        }),
      );
    }
    const buildMs = performance.now() - buildStarted;

    const searchStarted = performance.now();
    const results = index.search('investigation target');
    const searchMs = performance.now() - searchStarted;

    expect(results.map((r) => r.id)).toEqual(['n2500']);
    // Production target is 400 ms build / 30 ms search (P7 §10); the bound here is generous to
    // avoid flaking on slow CI runners while still catching an accidental O(n²) regression.
    expect(buildMs).toBeLessThan(3000);
    expect(searchMs).toBeLessThan(300);
  });
});
