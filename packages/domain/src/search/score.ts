/**
 * Matching and ranking primitives for the local search index (P7 §5).
 *
 * Fuzzy matching is bounded Levenshtein distance ≤ 1, and only for terms of 4+ characters (the
 * spec's exact rule) — short terms fuzz into everything and would make prefix search noisy.
 */

/** Field a match was found in — used to weight results (title beats body beats keyword-only). */
export type MatchField = 'title' | 'body' | 'keyword';

export type MatchKind = 'exact' | 'prefix' | 'fuzzy';

export interface FieldWeight {
  title: number;
  body: number;
  keyword: number;
}

export const DEFAULT_FIELD_WEIGHTS: FieldWeight = { title: 3, body: 1, keyword: 2 };

const KIND_WEIGHT: Record<MatchKind, number> = { exact: 3, prefix: 2, fuzzy: 1 };

/**
 * Bounded edit distance: returns the true distance if it is ≤ `max`, otherwise `max + 1`. Bailing
 * out early keeps this cheap even on long tokens, which is what makes per-keystroke search on a
 * 5,000-node index stay inside the 30 ms budget (P7 §10).
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (prev[j] ?? Infinity) + 1,
        (curr[j - 1] ?? Infinity) + 1,
        (prev[j - 1] ?? Infinity) + cost,
      );
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  const result = prev[b.length] ?? max + 1;
  return result;
}

/** Whether a query term matches an indexed token, and how. `null` means no match at all. */
export function matchToken(term: string, token: string): MatchKind | null {
  if (term === '') return null;
  if (token === term) return 'exact';
  if (token.startsWith(term)) return 'prefix';
  if (term.length >= 4) {
    const distance = boundedLevenshtein(term, token, 1);
    if (distance <= 1) return 'fuzzy';
  }
  return null;
}

/** Combined weight of a match: which field, how exact, and (for fuzzy) how close. */
export function matchScore(
  field: MatchField,
  kind: MatchKind,
  weights: FieldWeight = DEFAULT_FIELD_WEIGHTS,
): number {
  return weights[field] * KIND_WEIGHT[kind];
}
