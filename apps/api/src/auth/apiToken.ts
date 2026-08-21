/**
 * Scoped API tokens for the REST v1 surface (09_BACKEND.md §4.1, 10_INTEGRATIONS.md §10).
 *
 * Three properties this module exists to guarantee:
 *   1. the plaintext token is shown exactly once and is not recoverable from the database
 *      (argon2id at rest, with the parameters spelled out below);
 *   2. a token can never exceed its creating user's own permissions — the intersection is computed
 *      *per request*, so demoting a user takes effect immediately, without touching the token;
 *   3. a revoked or expired token stops working on the next request, not on the next cache sweep.
 *
 * This is the shared primitive P6's deferred `capture:write` scope and the browser extension will
 * reuse; adding a scope is a line in `API_SCOPES`, not a change here.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { argon2id } from '@noble/hashes/argon2.js';

export const TOKEN_PREFIX = 'nxs_';
export const TOKEN_RANDOM_BYTES = 32;
export const TOKEN_DISPLAY_PREFIX_LENGTH = 12;

/**
 * OWASP's argon2id baseline (m=19 MiB, t=2, p=1). Kept here rather than in env: a deployment that
 * can weaken password hashing by configuration eventually does.
 */
export const ARGON2_PARAMS = { t: 2, m: 19_456, p: 1, dkLen: 32 } as const;
const SALT_BYTES = 16;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Base62 of 32 random bytes: ~190 bits, URL-safe, no padding, no ambiguity in a shell. */
export function base62(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  if (value === 0n) return '0';
  let out = '';
  while (value > 0n) {
    out = BASE62[Number(value % 62n)] + out;
    value /= 62n;
  }
  return out;
}

export const API_SCOPES = [
  'boards:read',
  'boards:write',
  'nodes:read',
  'nodes:write',
  'runs:read',
  'runs:start',
  'proposals:read',
  'proposals:apply',
  'files:read',
  'files:write',
  // Reserved for P6's browser extension; declared here so the token table never needs a migration
  // to support it.
  'capture:write',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/** Org roles, ranked, and the scopes each rank may ever hold (09_BACKEND.md §4.1). */
export const ROLE_SCOPES: Readonly<
  Record<'viewer' | 'editor' | 'admin' | 'owner', readonly ApiScope[]>
> = {
  viewer: ['boards:read', 'nodes:read', 'runs:read', 'proposals:read', 'files:read'],
  editor: [
    'boards:read',
    'boards:write',
    'nodes:read',
    'nodes:write',
    'runs:read',
    'runs:start',
    'proposals:read',
    'proposals:apply',
    'files:read',
    'files:write',
    'capture:write',
  ],
  admin: [...API_SCOPES],
  owner: [...API_SCOPES],
};

export interface GeneratedToken {
  /** Shown once, never stored. */
  readonly plaintext: string;
  readonly prefix: string;
  readonly hash: string;
}

export function generateToken(random: (size: number) => Uint8Array = randomBytes): GeneratedToken {
  const plaintext = `${TOKEN_PREFIX}${base62(random(TOKEN_RANDOM_BYTES))}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH),
    hash: hashToken(plaintext, random(SALT_BYTES)),
  };
}

/** `$argon2id$v=19$m=…,t=…,p=…$<salt b64>$<hash b64>`, the standard PHC string. */
export function hashToken(plaintext: string, salt: Uint8Array = randomBytes(SALT_BYTES)): string {
  const digest = argon2id(new TextEncoder().encode(plaintext), salt, ARGON2_PARAMS);
  const b64 = (bytes: Uint8Array): string =>
    Buffer.from(bytes).toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${String(ARGON2_PARAMS.m)},t=${String(ARGON2_PARAMS.t)},p=${String(
    ARGON2_PARAMS.p,
  )}$${b64(salt)}$${b64(digest)}`;
}

export function verifyToken(plaintext: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[1] !== 'argon2id') return false;
  const params = Object.fromEntries(
    (parts[3] ?? '').split(',').map((pair) => {
      const [key = '', value = ''] = pair.split('=');
      return [key, Number(value)];
    }),
  ) as { m?: number; t?: number; p?: number };
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  const digest = Buffer.from(
    argon2id(new TextEncoder().encode(plaintext), salt, {
      t: params.t ?? ARGON2_PARAMS.t,
      m: params.m ?? ARGON2_PARAMS.m,
      p: params.p ?? ARGON2_PARAMS.p,
      dkLen: expected.length,
    }),
  );
  return digest.length === expected.length && timingSafeEqual(digest, expected);
}

export function looksLikeApiToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length > TOKEN_PREFIX.length + 20;
}

export function displayPrefix(plaintext: string): string {
  return plaintext.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH);
}

export interface StoredApiToken {
  readonly id: string;
  readonly orgId: string;
  readonly userId: string;
  readonly hash: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

export type TokenRejection = 'not_found' | 'revoked' | 'expired' | 'no_membership' | 'bad_secret';

export interface ResolvedToken {
  readonly tokenId: string;
  readonly userId: string;
  readonly orgId: string;
  /** The intersection of the token's scopes and what the user may currently do. */
  readonly scopes: readonly ApiScope[];
}

export type TokenResolution =
  | { readonly ok: true; readonly token: ResolvedToken }
  | { readonly ok: false; readonly reason: TokenRejection };

export interface ResolveInput {
  readonly plaintext: string;
  readonly stored: StoredApiToken | null;
  /** The caller's *current* role in the token's org, or null if they were removed. */
  readonly role: 'viewer' | 'editor' | 'admin' | 'owner' | null;
  readonly now: Date;
}

/**
 * The per-request check. Deliberately pure: `test/apiToken.test.ts` covers the whole matrix
 * (revoked, expired, demoted, removed) without a database.
 */
export function resolveToken(input: ResolveInput): TokenResolution {
  const stored = input.stored;
  if (stored === null) return { ok: false, reason: 'not_found' };
  if (stored.revokedAt !== null) return { ok: false, reason: 'revoked' };
  if (stored.expiresAt !== null && stored.expiresAt.getTime() <= input.now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  if (!verifyToken(input.plaintext, stored.hash)) return { ok: false, reason: 'bad_secret' };
  // Removed from the org: 403 with no hint that the project exists (§8 edge cases).
  if (input.role === null) return { ok: false, reason: 'no_membership' };

  const allowed = new Set<string>(ROLE_SCOPES[input.role]);
  const scopes = stored.scopes.filter(
    (scope): scope is ApiScope => isApiScope(scope) && allowed.has(scope),
  );
  return {
    ok: true,
    token: { tokenId: stored.id, userId: stored.userId, orgId: stored.orgId, scopes },
  };
}

/** Scope check at the endpoint: `runs:start` is not implied by `runs:read`. */
export function hasScope(scopes: readonly ApiScope[], required: ApiScope): boolean {
  return scopes.includes(required);
}
