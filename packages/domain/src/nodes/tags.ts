/**
 * Tag normalisation (P4 §5.7). Tags are free-form, so the rules live in one place and every writer
 * goes through it: the inspector, paste capture, import and tool output all produce the same set.
 *
 * Deduplication is case-insensitive but the first spelling wins, because analysts type `OSINT` and
 * `osint` for the same thing and re-casing their input feels like the app is arguing with them.
 */

export const MAX_TAGS_PER_NODE = 32;
export const MAX_TAG_LENGTH = 48;

export interface TagRejection {
  value: string;
  reason: 'empty' | 'too-long' | 'duplicate' | 'over-limit';
  message: string;
}

export interface NormalizedTags {
  tags: string[];
  rejected: TagRejection[];
}

/** Trims, collapses inner whitespace and clamps one tag. Returns '' when nothing is left. */
export function normalizeTag(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeTags(values: readonly string[]): NormalizedTags {
  const tags: string[] = [];
  const rejected: TagRejection[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    const value = normalizeTag(raw);
    if (value === '') {
      rejected.push({ value: raw, reason: 'empty', message: 'A tag cannot be blank.' });
      continue;
    }
    if (value.length > MAX_TAG_LENGTH) {
      rejected.push({
        value,
        reason: 'too-long',
        message: `"${value.slice(0, 20)}…" is ${String(value.length)} characters; tags are limited to ${String(MAX_TAG_LENGTH)}.`,
      });
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      rejected.push({ value, reason: 'duplicate', message: `"${value}" is already on this node.` });
      continue;
    }
    if (tags.length >= MAX_TAGS_PER_NODE) {
      rejected.push({
        value,
        reason: 'over-limit',
        message: `A node holds at most ${String(MAX_TAGS_PER_NODE)} tags. Remove one before adding "${value}".`,
      });
      continue;
    }
    seen.add(key);
    tags.push(value);
  }

  return { tags, rejected };
}

/** Adds tags to an existing set, keeping the existing order and the existing spellings. */
export function addTags(current: readonly string[], added: readonly string[]): NormalizedTags {
  return normalizeTags([...current, ...added]);
}

export function removeTag(current: readonly string[], value: string): string[] {
  const key = normalizeTag(value).toLowerCase();
  return current.filter((tag) => tag.toLowerCase() !== key);
}

/** Board-wide tag suggestions, most used first, then alphabetically for a stable order. */
export function suggestTags(
  allTags: ReadonlyArray<readonly string[]>,
  query: string,
  limit = 8,
): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const tags of allTags) {
    for (const tag of tags) {
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry === undefined) counts.set(key, { label: tag, count: 1 });
      else entry.count += 1;
    }
  }
  const needle = normalizeTag(query).toLowerCase();
  return [...counts.entries()]
    .filter(([key]) => needle === '' || key.includes(needle))
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([, entry]) => entry.label);
}
