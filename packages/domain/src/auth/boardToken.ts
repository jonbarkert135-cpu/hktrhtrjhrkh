/**
 * Board tokens (P8 §5.1/§5.2/§9): short-lived, HMAC-signed, single-board-scoped credentials.
 * The API signs them (`apps/api/src/trpc/routers/boardToken.ts`); `apps/sync` verifies them
 * (`apps/sync/src/auth.ts`). Living in `packages/domain` keeps both sides importing the same
 * signature logic without one app importing another (00_MASTER.md §5 layering).
 *
 * HMAC is hand-rolled on top of `files/sha256.ts` instead of `node:crypto` because `packages/
 * domain` is runtime-agnostic (N-pure, 08_DATA_MODEL.md scope note) — this module is reachable
 * from the browser bundle through the package barrel, and `node:crypto` has no browser build.
 */

import { sha256Hex } from '../files/sha256.ts';

const BLOCK_SIZE = 64; // SHA-256's block size in bytes.

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** HMAC-SHA256(key, message), hex-encoded (RFC 2104). */
function hmacSha256Hex(key: Uint8Array, message: Uint8Array): string {
  let k = key.length > BLOCK_SIZE ? hexToBytes(sha256Hex(key)) : key;
  if (k.length < BLOCK_SIZE) {
    const padded = new Uint8Array(BLOCK_SIZE);
    padded.set(k);
    k = padded;
  }
  const ipad = new Uint8Array(BLOCK_SIZE);
  const opad = new Uint8Array(BLOCK_SIZE);
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    const byte = k[i] ?? 0;
    ipad[i] = byte ^ 0x36;
    opad[i] = byte ^ 0x5c;
  }
  const inner = hexToBytes(sha256Hex(concat(ipad, message)));
  return sha256Hex(concat(opad, inner));
}

/** Constant-time byte comparison — no early return on the first mismatch. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const BOARD_TOKEN_TTL_MS = 5 * 60 * 1000;

export const BOARD_ROLES = ['viewer', 'editor', 'admin', 'owner'] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];

export interface BoardTokenPayload {
  userId: string;
  boardId: string;
  role: BoardRole;
  name: string;
  color: string;
  /** epoch ms; token is invalid at or after this instant. */
  exp: number;
}

/** base64url, implemented on bytes so it needs neither `Buffer` (Node) nor `btoa` (browser-only). */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary =
    typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sign(payloadJson: string, secret: string): string {
  return bytesToBase64Url(hexToBytes(hmacSha256Hex(textToBytes(secret), textToBytes(payloadJson))));
}

/** Issued by the API; one token authorizes exactly one board for exactly one connection window. */
export function signBoardToken(
  payload: Omit<BoardTokenPayload, 'exp'>,
  secret: string,
  now = Date.now(),
): string {
  const full: BoardTokenPayload = { ...payload, exp: now + BOARD_TOKEN_TTL_MS };
  const payloadJson = JSON.stringify(full);
  const payloadPart = bytesToBase64Url(textToBytes(payloadJson));
  const sig = sign(payloadJson, secret);
  return `${payloadPart}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: BoardTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' | 'wrong-board' };

/**
 * Verifies a token against the shared secret and, when `expectedBoardId` is given, that the
 * token's scope matches the room being joined (P8 §1: "single board scope" — a token for board A
 * must never open a connection to board B even if the signature is valid).
 */
export function verifyBoardToken(
  token: string,
  secret: string,
  expectedBoardId?: string,
  now = Date.now(),
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [payloadPart, sig] = parts as [string, string];

  let payloadJson: string;
  let payload: BoardTokenPayload;
  try {
    payloadJson = new TextDecoder().decode(base64UrlToBytes(payloadPart));
    payload = JSON.parse(payloadJson) as BoardTokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    typeof payload.userId !== 'string' ||
    typeof payload.boardId !== 'string' ||
    typeof payload.exp !== 'number' ||
    !BOARD_ROLES.includes(payload.role)
  ) {
    return { ok: false, reason: 'malformed' };
  }

  const expectedSig = sign(payloadJson, secret);
  if (!timingSafeEqualHex(sig, expectedSig)) {
    return { ok: false, reason: 'bad-signature' };
  }
  if (now >= payload.exp) return { ok: false, reason: 'expired' };
  if (expectedBoardId !== undefined && payload.boardId !== expectedBoardId) {
    return { ok: false, reason: 'wrong-board' };
  }
  return { ok: true, payload };
}

export const isReadOnlyRole = (role: BoardRole): boolean => role === 'viewer';

/** `board:<uuid>` → `<uuid>` (09_BACKEND.md §5.1 room naming); undefined if the name is malformed. */
export function parseRoom(documentName: string): string | undefined {
  const [prefix, boardId] = documentName.split(':');
  if (prefix !== 'board' || !boardId) return undefined;
  return boardId;
}
