import { describe, expect, it } from 'vitest';

import {
  API_SCOPES,
  ARGON2_PARAMS,
  base62,
  generateToken,
  hashToken,
  hasScope,
  looksLikeApiToken,
  resolveToken,
  ROLE_SCOPES,
  TOKEN_PREFIX,
  verifyToken,
} from '../src/auth/apiToken.ts';

const NOW = new Date('2026-02-01T00:00:00.000Z');

const stored = (
  overrides: Partial<Parameters<typeof resolveToken>[0]['stored'] & object> = {},
) => ({
  id: 'token-1',
  orgId: 'org-1',
  userId: 'user-1',
  hash: hashToken('nxs_secret-value-for-tests'),
  scopes: ['runs:read', 'runs:start'],
  expiresAt: null as Date | null,
  revokedAt: null as Date | null,
  ...overrides,
});

describe('API token format (09_BACKEND.md §4.1)', () => {
  it('is nxs_ plus base62 of 32 random bytes', () => {
    const token = generateToken();
    expect(token.plaintext.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token.plaintext.length).toBeGreaterThan(TOKEN_PREFIX.length + 38);
    expect(token.plaintext.slice(TOKEN_PREFIX.length)).toMatch(/^[0-9A-Za-z]+$/);
    expect(token.prefix).toBe(token.plaintext.slice(0, 12));
    expect(looksLikeApiToken(token.plaintext)).toBe(true);
    expect(looksLikeApiToken('Bearer something')).toBe(false);
    expect(base62(new Uint8Array([0]))).toBe('0');
  });

  it('stores only an argon2id hash, and two tokens never share one', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a.hash).not.toContain(a.plaintext.slice(TOKEN_PREFIX.length));
    expect(a.hash).not.toBe(b.hash);
    expect(ARGON2_PARAMS.m).toBe(19_456);
  });

  it('verifies the right token and rejects a near miss', () => {
    const token = generateToken();
    expect(verifyToken(token.plaintext, token.hash)).toBe(true);
    expect(verifyToken(`${token.plaintext}x`, token.hash)).toBe(false);
    expect(verifyToken(token.plaintext, 'not-a-phc-string')).toBe(false);
  });
});

describe('per-request scope intersection', () => {
  const plaintext = 'nxs_secret-value-for-tests';

  it('grants the intersection of the token scopes and the current role', () => {
    const result = resolveToken({ plaintext, stored: stored(), role: 'editor', now: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token.scopes).toEqual(['runs:read', 'runs:start']);
      expect(hasScope(result.token.scopes, 'runs:start')).toBe(true);
      expect(hasScope(result.token.scopes, 'files:write')).toBe(false);
    }
  });

  it('drops scopes the user can no longer exercise after a demotion', () => {
    const result = resolveToken({ plaintext, stored: stored(), role: 'viewer', now: NOW });
    expect(result.ok).toBe(true);
    // A viewer keeps runs:read but loses runs:start, without the token being touched.
    if (result.ok) expect(result.token.scopes).toEqual(['runs:read']);
  });

  it('never lets a token exceed its creating user’s permissions', () => {
    const result = resolveToken({
      plaintext,
      stored: stored({ scopes: [...API_SCOPES] }),
      role: 'viewer',
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const scope of result.token.scopes) expect(ROLE_SCOPES.viewer).toContain(scope);
    }
  });

  it('refuses a revoked token on the very next request', () => {
    const result = resolveToken({
      plaintext,
      stored: stored({ revokedAt: new Date('2026-01-31T23:59:59.000Z') }),
      role: 'admin',
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });

  it('refuses an expired token', () => {
    const result = resolveToken({
      plaintext,
      stored: stored({ expiresAt: new Date('2026-01-31T00:00:00.000Z') }),
      role: 'admin',
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a caller who was removed from the org, without leaking why', () => {
    const result = resolveToken({ plaintext, stored: stored(), role: null, now: NOW });
    expect(result).toEqual({ ok: false, reason: 'no_membership' });
  });

  it('refuses an unknown token and a wrong secret', () => {
    expect(resolveToken({ plaintext, stored: null, role: 'admin', now: NOW })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(
      resolveToken({
        plaintext: 'nxs_wrong-value-entirely',
        stored: stored(),
        role: 'admin',
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      reason: 'bad_secret',
    });
  });
});
