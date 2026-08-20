import { describe, expect, it } from 'vitest';

import { CommentSchema, extractMentionHandles } from '../src/entities/comment.ts';

describe('extractMentionHandles', () => {
  it('finds one or more @handles in a comment body', () => {
    expect(extractMentionHandles('cc @alex and @sam.b, thanks')).toEqual(['alex', 'sam.b']);
  });

  it('dedupes repeated mentions, case-insensitively', () => {
    expect(extractMentionHandles('@Alex please review, @alex ping')).toEqual(['alex']);
  });

  it('ignores an email address (no arbitrary email injection, P8 §9)', () => {
    expect(extractMentionHandles('reach me at alex@example.com')).toEqual([]);
  });

  it('returns an empty list for a body with no mentions', () => {
    expect(extractMentionHandles('no mentions here')).toEqual([]);
  });
});

describe('CommentSchema', () => {
  it('accepts a node-anchored comment', () => {
    const parsed = CommentSchema.parse({
      id: 'c1',
      boardId: 'b1',
      anchor: { kind: 'node', nodeId: 'n1' },
      body: 'hello',
      authorId: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.anchor).toEqual({ kind: 'node', nodeId: 'n1' });
    expect(parsed.parentId).toBeNull();
  });

  it('accepts a point-anchored comment', () => {
    const parsed = CommentSchema.parse({
      id: 'c1',
      boardId: 'b1',
      anchor: { kind: 'point', x: 10, y: 20 },
      body: 'hello',
      authorId: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.anchor).toEqual({ kind: 'point', x: 10, y: 20 });
  });

  it('rejects a body over the 8,000-char cap', () => {
    expect(() =>
      CommentSchema.parse({
        id: 'c1',
        boardId: 'b1',
        anchor: { kind: 'node', nodeId: 'n1' },
        body: 'x'.repeat(8_001),
        authorId: 'u1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
