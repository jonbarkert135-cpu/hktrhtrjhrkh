/**
 * Identity keys (10_INTEGRATIONS.md §8.2).
 *
 * `kind:canonicalValue` is the whole scheme. It is deliberately readable: it appears in
 * `props.__identityKey` on every node, in proposal payloads and in run diffs, and a key you can
 * read is a key you can debug. Manual nodes get one through the same normalizers, which is what
 * makes tool results merge with hand-made nodes instead of duplicating them.
 */

import type { EntityKind } from '../manifest.ts';
import { normalize, type NormalizeContext } from '../extract/normalizers.ts';

export const IDENTITY_KEY_PROP = '__identityKey';
export const PROVENANCE_PROP = '__provenance';
export const MANUAL_EDIT_PROP = '__manual';

export function identityKey(kind: EntityKind, canonicalValue: string): string {
  return `${kind}:${canonicalValue}`;
}

export interface IdentityResult {
  readonly ok: boolean;
  readonly key?: string;
  readonly value?: string;
  readonly display?: string;
  readonly meta?: Record<string, unknown>;
  readonly reason?: string;
}

/** Normalizes then keys in one step; the only supported way to derive a key from a raw value. */
export function identityFor(kind: EntityKind, raw: string, ctx?: NormalizeContext): IdentityResult {
  const normalized = normalize(kind, raw, ctx);
  if (!normalized.ok || normalized.value === undefined) {
    return { ok: false, reason: normalized.reason ?? 'could not be normalized' };
  }
  return {
    ok: true,
    key: identityKey(kind, normalized.value),
    value: normalized.value,
    display: normalized.display ?? raw,
    ...(normalized.meta ? { meta: normalized.meta } : {}),
  };
}

export function parseIdentityKey(key: string): { kind: string; value: string } | undefined {
  const colon = key.indexOf(':');
  if (colon <= 0) return undefined;
  return { kind: key.slice(0, colon), value: key.slice(colon + 1) };
}

/**
 * A stable, short `tempId` for a proposal item — `n:` plus a hash of the identity key. Proposals
 * are compared and re-applied by these ids, so they must be deterministic across processes:
 * FNV-1a, not `Math.random`.
 */
export function tempIdFor(prefix: 'n' | 'e', identity: string): string {
  return `${prefix}:${fnv1a(identity)}`;
}

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
