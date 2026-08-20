/**
 * P8 §11: `apps/sync/test/auth.test.ts` — valid/expired/wrong-board/viewer board tokens.
 */

import { describe, expect, it } from 'vitest';

import {
  AuthError,
  BOARD_TOKEN_TTL_MS,
  authenticateBoardToken,
  isReadOnlyRole,
  parseRoom,
  signBoardToken,
  verifyBoardToken,
} from '../src/auth.ts';

const SECRET = 'x'.repeat(32);
const OTHER_SECRET = 'y'.repeat(32);

describe('board tokens', () => {
  it('a valid token verifies and scopes to its board', () => {
    const token = signBoardToken(
      { userId: 'u1', boardId: 'b1', role: 'editor', name: 'Alex', color: '#ff0000' },
      SECRET,
    );
    const result = verifyBoardToken(token, SECRET, 'b1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.userId).toBe('u1');
      expect(result.payload.role).toBe('editor');
    }
  });

  it('rejects an expired token', () => {
    const issuedAt = 1_700_000_000_000;
    const token = signBoardToken(
      { userId: 'u1', boardId: 'b1', role: 'editor', name: 'Alex', color: '#fff' },
      SECRET,
      issuedAt,
    );
    const result = verifyBoardToken(token, SECRET, 'b1', issuedAt + BOARD_TOKEN_TTL_MS);
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('a token scoped to another board is rejected for this room', () => {
    const token = signBoardToken(
      { userId: 'u1', boardId: 'b1', role: 'editor', name: 'Alex', color: '#fff' },
      SECRET,
    );
    const result = verifyBoardToken(token, SECRET, 'b2');
    expect(result).toEqual({ ok: false, reason: 'wrong-board' });
  });

  it('a tampered or wrongly-signed token is rejected', () => {
    const token = signBoardToken(
      { userId: 'u1', boardId: 'b1', role: 'viewer', name: 'Alex', color: '#fff' },
      OTHER_SECRET,
    );
    const result = verifyBoardToken(token, SECRET, 'b1');
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('a malformed token is rejected without throwing', () => {
    expect(verifyBoardToken('not-a-token', SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyBoardToken('a.b.c', SECRET)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('a viewer role is read-only', () => {
    expect(isReadOnlyRole('viewer')).toBe(true);
    expect(isReadOnlyRole('editor')).toBe(false);
    expect(isReadOnlyRole('admin')).toBe(false);
    expect(isReadOnlyRole('owner')).toBe(false);
  });

  it('parses the Hocuspocus room name into a board id', () => {
    expect(parseRoom('board:abc123')).toBe('abc123');
    expect(parseRoom('not-a-room')).toBeUndefined();
    expect(parseRoom('board:')).toBeUndefined();
  });
});

describe('authenticateBoardToken (onAuthenticate)', () => {
  it('accepts a valid token for the room it names', () => {
    const token = signBoardToken(
      { userId: 'u1', boardId: 'b1', role: 'admin', name: 'Alex', color: '#fff' },
      SECRET,
    );
    const ctx = authenticateBoardToken({ token, documentName: 'board:b1' }, SECRET);
    expect(ctx).toMatchObject({ userId: 'u1', boardId: 'b1', role: 'admin', readOnly: false });
  });

  it('closes with 4401 for an expired token', () => {
    const issuedAt = 1_700_000_000_000;
    const token = signBoardToken(
      { userId: 'u1', boardId: 'b1', role: 'editor', name: 'Alex', color: '#fff' },
      SECRET,
      issuedAt,
    );
    const realDateNow = Date.now;
    Date.now = () => issuedAt + BOARD_TOKEN_TTL_MS + 1;
    try {
      expect(() => authenticateBoardToken({ token, documentName: 'board:b1' }, SECRET)).toThrow(
        AuthError,
      );
    } finally {
      Date.now = realDateNow;
    }
  });

  it('closes with 4403 for a token scoped to a different board', () => {
    const token = signBoardToken(
      { userId: 'u1', boardId: 'b1', role: 'editor', name: 'Alex', color: '#fff' },
      SECRET,
    );
    try {
      authenticateBoardToken({ token, documentName: 'board:b2' }, SECRET);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe(4403);
    }
  });

  it('marks a viewer token read-only so the server can reject its updates', () => {
    const token = signBoardToken(
      { userId: 'u1', boardId: 'b1', role: 'viewer', name: 'Alex', color: '#fff' },
      SECRET,
    );
    const ctx = authenticateBoardToken({ token, documentName: 'board:b1' }, SECRET);
    expect(ctx.readOnly).toBe(true);
  });

  it('a malformed room name closes with 4401', () => {
    const token = signBoardToken(
      { userId: 'u1', boardId: 'b1', role: 'editor', name: 'Alex', color: '#fff' },
      SECRET,
    );
    expect(() => authenticateBoardToken({ token, documentName: 'garbage' }, SECRET)).toThrow(
      AuthError,
    );
  });
});
