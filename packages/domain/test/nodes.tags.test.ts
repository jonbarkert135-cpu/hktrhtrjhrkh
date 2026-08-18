/**
 * Tag rules (P4 §5.7). The interesting part is not the happy path but what happens to the input an
 * analyst actually types: trailing spaces, a second casing of the same word, and one tag too many.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_TAGS_PER_NODE,
  MAX_TAG_LENGTH,
  addTags,
  normalizeTag,
  normalizeTags,
  removeTag,
  suggestTags,
} from '../src/nodes/tags.ts';

describe('normalizeTags', () => {
  it('trims, collapses whitespace and keeps the first spelling of a duplicate', () => {
    const result = normalizeTags(['  OSINT ', 'osint', 'threat   intel']);
    expect(result.tags).toEqual(['OSINT', 'threat intel']);
    expect(result.rejected.map((entry) => entry.reason)).toEqual(['duplicate']);
    expect(result.rejected[0]?.message).toContain('already on this node');
  });

  it('rejects blank tags with a reason', () => {
    const result = normalizeTags(['   ', '\n\t']);
    expect(result.tags).toEqual([]);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((entry) => entry.reason === 'empty')).toBe(true);
  });

  it('keeps an emoji-only tag', () => {
    expect(normalizeTags(['🚩']).tags).toEqual(['🚩']);
  });

  it('rejects a tag longer than the limit and says how long it was', () => {
    const long = 'x'.repeat(MAX_TAG_LENGTH + 1);
    const result = normalizeTags([long]);
    expect(result.tags).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('too-long');
    expect(result.rejected[0]?.message).toContain(String(MAX_TAG_LENGTH + 1));
  });

  it('stops at the per-node limit', () => {
    const many = Array.from(
      { length: MAX_TAGS_PER_NODE + 3 },
      (_, index) => `tag-${String(index)}`,
    );
    const result = normalizeTags(many);
    expect(result.tags).toHaveLength(MAX_TAGS_PER_NODE);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected[0]?.reason).toBe('over-limit');
  });

  it('normalizeTag is the single trimming rule', () => {
    expect(normalizeTag('  a   b  ')).toBe('a b');
  });
});

describe('addTags / removeTag', () => {
  it('appends without disturbing the existing order', () => {
    expect(addTags(['alpha', 'beta'], ['gamma', 'ALPHA']).tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('removes case-insensitively', () => {
    expect(removeTag(['Alpha', 'beta'], 'ALPHA')).toEqual(['beta']);
    expect(removeTag(['Alpha'], 'gamma')).toEqual(['Alpha']);
  });
});

describe('suggestTags', () => {
  const board = [['osint', 'people'], ['osint'], ['OSINT', 'infra'], ['people']];

  it('ranks by usage, then alphabetically', () => {
    expect(suggestTags(board, '')).toEqual(['osint', 'people', 'infra']);
  });

  it('filters by the typed prefix or substring', () => {
    expect(suggestTags(board, 'inf')).toEqual(['infra']);
    expect(suggestTags(board, 'in')).toEqual(['osint', 'infra']);
    expect(suggestTags(board, 'zzz')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(suggestTags(board, '', 1)).toEqual(['osint']);
  });
});
