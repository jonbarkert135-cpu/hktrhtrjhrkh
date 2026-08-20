/**
 * packages/domain/src/auth/boardToken.ts — sign/verify round trip, tamper detection, expiry and
 * board-scope enforcement (P8 §5.1/§5.2/§9), plus the `board:<uuid>` room-name parser.
 */

import { describe, expect, it } from 'vitest';
import {
  BOARD_TOKEN_TTL_MS,
  isReadOnlyRole,
  parseRoom,
  signBoardToken,
  verifyBoardToken,
  type BoardTokenPayload,
} from '../src/auth/boardToken.ts';

const SECRET = 'a-shared-secret-at-least-this-long';
const PAYLOAD = {
  userId: 'u1',
  boardId: 'b1',
  role: 'editor' as const,
  name: 'Ada',
  color: 'hsl(10, 70%, 55%)',
};

describe('signBoardToken / verifyBoardToken', () => {
  it('round-trips a signed token', () => {
    const token = signBoardToken(PAYLOAD, SECRET);
    const result = verifyBoardToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.userId).toBe('u1');
      expect(result.payload.boardId).toBe('b1');
      expect(result.payload.role).toBe('editor');
      expect(result.payload.name).toBe('Ada');
      expect(result.payload.color).toBe('hsl(10, 70%, 55%)');
    }
  });

  it('sets exp to now + BOARD_TOKEN_TTL_MS', () => {
    const now = 1_000_000;
    const token = signBoardToken(PAYLOAD, SECRET, now);
    const result = verifyBoardToken(token, SECRET, undefined, now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.exp).toBe(now + BOARD_TOKEN_TTL_MS);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signBoardToken(PAYLOAD, SECRET);
    const result = verifyBoardToken(token, 'a-different-secret-value');
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a token whose payload was tampered with', () => {
    const token = signBoardToken(PAYLOAD, SECRET);
    const [payloadPart, sig] = token.split('.') as [string, string];
    const decoded = JSON.parse(
      Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as BoardTokenPayload;
    const tamperedJson = JSON.stringify({ ...decoded, role: 'owner' });
    const tamperedPart = Buffer.from(tamperedJson, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const tampered = `${tamperedPart}.${sig}`;
    const result = verifyBoardToken(tampered, SECRET);
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a malformed token with no dot separator', () => {
    expect(verifyBoardToken('not-a-token', SECRET)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a token whose payload is not valid base64url JSON', () => {
    expect(verifyBoardToken('!!!!.sig', SECRET)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a payload missing required fields', () => {
    const payloadPart = Buffer.from(JSON.stringify({ userId: 'u1' }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifyBoardToken(`${payloadPart}.sig`, SECRET)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a payload with an invalid role', () => {
    const bad = { ...PAYLOAD, role: 'superadmin' };
    const payloadJson = JSON.stringify({ ...bad, exp: Date.now() + 1000 });
    const payloadPart = Buffer.from(payloadJson, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifyBoardToken(`${payloadPart}.sig`, SECRET)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects an expired token', () => {
    const now = 1_000_000;
    const token = signBoardToken(PAYLOAD, SECRET, now);
    const result = verifyBoardToken(token, SECRET, undefined, now + BOARD_TOKEN_TTL_MS + 1);
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('treats a token valid at exactly its exp instant as expired', () => {
    const now = 1_000_000;
    const token = signBoardToken(PAYLOAD, SECRET, now);
    const result = verifyBoardToken(token, SECRET, undefined, now + BOARD_TOKEN_TTL_MS);
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token scoped to a different board', () => {
    const token = signBoardToken(PAYLOAD, SECRET);
    const result = verifyBoardToken(token, SECRET, 'some-other-board');
    expect(result).toEqual({ ok: false, reason: 'wrong-board' });
  });

  it('accepts a token when the expected board matches', () => {
    const token = signBoardToken(PAYLOAD, SECRET);
    const result = verifyBoardToken(token, SECRET, 'b1');
    expect(result.ok).toBe(true);
  });
});

describe('isReadOnlyRole', () => {
  it('is read-only for viewer only', () => {
    expect(isReadOnlyRole('viewer')).toBe(true);
    expect(isReadOnlyRole('editor')).toBe(false);
    expect(isReadOnlyRole('admin')).toBe(false);
    expect(isReadOnlyRole('owner')).toBe(false);
  });
});

describe('parseRoom', () => {
  it('extracts the board id from a well-formed room name', () => {
    expect(parseRoom('board:abc123')).toBe('abc123');
  });

  it('returns undefined for a non-board prefix', () => {
    expect(parseRoom('other:abc123')).toBeUndefined();
  });

  it('returns undefined when the board id is missing', () => {
    expect(parseRoom('board:')).toBeUndefined();
  });

  it('returns undefined for a name with no colon', () => {
    expect(parseRoom('abc123')).toBeUndefined();
  });
});
