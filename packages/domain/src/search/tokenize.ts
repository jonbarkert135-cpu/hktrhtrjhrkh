/**
 * Tokenizer shared by indexing and querying (P7 §5/§7). Kept trivial on purpose: the local index
 * is a client-side convenience, not a linguistic engine — `websearch_to_tsquery` on the server
 * (P8's projection) does the heavy lifting once that side exists.
 */

/** Lower-cases and splits on anything that is not a letter, digit or a few name-ish joiners. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/** `tokenize`, deduplicated and order-preserving — the shape a postings list wants. */
export function uniqueTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokenize(text)) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}
