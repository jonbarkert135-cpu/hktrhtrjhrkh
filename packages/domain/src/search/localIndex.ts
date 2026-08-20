/**
 * The in-memory, incremental local search index (P7 §5/§7).
 *
 * This runs entirely in the browser tab: no network, no server. It indexes whatever the caller
 * feeds it — one open board's nodes, or a whole local workspace's worth pulled from IndexedDB —
 * and answers prefix + fuzzy queries ranked by field and match quality.
 *
 * Incremental by construction: `upsert`/`remove` touch only the postings of the changed document,
 * which is what keeps rebuilds off the frame path (N1) when the caller wires this to `observeBoard`
 * change batches instead of re-indexing the whole board on every keystroke.
 */

import { type MatchField, matchScore, matchToken } from './score.ts';
import { uniqueTokens } from './tokenize.ts';

export interface IndexedDoc {
  /** Unique across the whole index, e.g. a node id. */
  id: string;
  /** Groups results (P7 §7: "results grouped by board"). */
  boardId: string;
  title: string;
  body: string;
  keywords: readonly string[];
}

export interface LocalSearchResult {
  id: string;
  boardId: string;
  score: number;
  matchedTerms: readonly string[];
  title: string;
  body: string;
}

export interface LocalSearchOptions {
  limit?: number;
  /** Restrict to one board; omit to search the whole index. */
  boardId?: string;
}

type FieldTokenMap = Map<string, Set<MatchField>>;

/** Reverse index: token → (docId → fields it appeared in for that doc). */
type Postings = Map<string, Map<string, Set<MatchField>>>;

function fieldTokens(doc: IndexedDoc): FieldTokenMap {
  const map: FieldTokenMap = new Map();
  const add = (text: string, field: MatchField) => {
    for (const token of uniqueTokens(text)) {
      const fields = map.get(token) ?? new Set<MatchField>();
      fields.add(field);
      map.set(token, fields);
    }
  };
  add(doc.title, 'title');
  add(doc.body, 'body');
  for (const keyword of doc.keywords) add(keyword, 'keyword');
  return map;
}

export interface LocalIndex {
  upsert(doc: IndexedDoc): void;
  remove(id: string): void;
  clear(): void;
  readonly size: number;
  search(query: string, options?: LocalSearchOptions): LocalSearchResult[];
}

export function createLocalIndex(): LocalIndex {
  const docs = new Map<string, IndexedDoc>();
  const docTokens = new Map<string, FieldTokenMap>();
  const postings: Postings = new Map();

  const unindex = (id: string): void => {
    const tokens = docTokens.get(id);
    if (tokens === undefined) return;
    for (const token of tokens.keys()) {
      const byDoc = postings.get(token);
      if (byDoc === undefined) continue;
      byDoc.delete(id);
      if (byDoc.size === 0) postings.delete(token);
    }
    docTokens.delete(id);
  };

  return {
    get size() {
      return docs.size;
    },

    upsert(doc) {
      unindex(doc.id);
      docs.set(doc.id, doc);
      const tokens = fieldTokens(doc);
      docTokens.set(doc.id, tokens);
      for (const [token, fields] of tokens) {
        const byDoc = postings.get(token) ?? new Map<string, Set<MatchField>>();
        byDoc.set(doc.id, fields);
        postings.set(token, byDoc);
      }
    },

    remove(id) {
      unindex(id);
      docs.delete(id);
    },

    clear() {
      docs.clear();
      docTokens.clear();
      postings.clear();
    },

    search(query, options = {}) {
      const terms = uniqueTokens(query);
      if (terms.length === 0) return [];
      const limit = options.limit ?? 50;

      const scores = new Map<string, number>();
      const matched = new Map<string, Set<string>>();

      for (const term of terms) {
        for (const [token, byDoc] of postings) {
          const kind = matchToken(term, token);
          if (kind === null) continue;
          for (const [docId, fields] of byDoc) {
            if (options.boardId !== undefined && docs.get(docId)?.boardId !== options.boardId) {
              continue;
            }
            let gained = 0;
            for (const field of fields) gained += matchScore(field, kind);
            scores.set(docId, (scores.get(docId) ?? 0) + gained);
            const terms2 = matched.get(docId) ?? new Set<string>();
            terms2.add(term);
            matched.set(docId, terms2);
          }
        }
      }

      const results: LocalSearchResult[] = [];
      for (const [docId, matchedTerms] of matched) {
        // AND semantics across query terms: every term must match somewhere in the document.
        if (matchedTerms.size !== terms.length) continue;
        const doc = docs.get(docId);
        if (doc === undefined) continue;
        results.push({
          id: doc.id,
          boardId: doc.boardId,
          score: scores.get(docId) ?? 0,
          matchedTerms: [...matchedTerms],
          title: doc.title,
          body: doc.body,
        });
      }

      results.sort(
        (a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      );
      return results.slice(0, limit);
    },
  };
}
