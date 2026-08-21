/**
 * Dedupe / merge policy (10_INTEGRATIONS.md §8.3).
 *
 * The bias is explicit: a false merge is much worse than a duplicate node, so the fuzzy threshold
 * is high (0.82), fuzzy matches never merge — they become a conflict the user decides — and a field
 * the user edited by hand is never overwritten without asking.
 */

import type { EntityKind } from '../manifest.ts';
import { MANUAL_EDIT_PROP } from './identity.ts';

/** Threshold from the fixture corpus (precision 0.94 / recall 0.71). Org-tunable later, not now. */
export const FUZZY_THRESHOLD = 0.82;

/** Fields that accumulate rather than replace (§8.3). */
export const SET_FIELDS: ReadonlySet<string> = new Set(['tags', 'aliases', 'urls', 'emails']);

export interface ExistingNodeMatch {
  readonly nodeId: string;
  readonly kind: EntityKind;
  readonly identityKey?: string;
  readonly title: string;
  readonly props: Readonly<Record<string, unknown>>;
  /** Which board the match is on; a match on another board suggests a link, never a merge. */
  readonly boardId: string;
  readonly confidence?: number;
}

export type Resolution = 'MERGE' | 'SUGGEST_LINK' | 'CONFLICT' | 'NEW';

export interface ResolutionResult {
  readonly resolution: Resolution;
  readonly match?: ExistingNodeMatch;
  readonly reason: string;
  readonly similarity?: number;
}

export interface ResolveInput {
  readonly kind: EntityKind;
  readonly identityKey: string;
  readonly display: string;
  readonly boardId: string;
}

/**
 * §8.3's ordered resolution. `candidates` are whatever the caller could cheaply find: the board's
 * identity index plus, when the proposal is built server-side, the `pg_trgm` neighbours.
 */
export function resolveEntity(
  input: ResolveInput,
  candidates: readonly ExistingNodeMatch[],
): ResolutionResult {
  const exactOnBoard = candidates.find(
    (c) => c.identityKey === input.identityKey && c.boardId === input.boardId,
  );
  if (exactOnBoard) {
    return { resolution: 'MERGE', match: exactOnBoard, reason: 'same identity on this board' };
  }

  const exactElsewhere = candidates.find((c) => c.identityKey === input.identityKey);
  if (exactElsewhere) {
    return {
      resolution: 'SUGGEST_LINK',
      match: exactElsewhere,
      reason: 'same identity on another board in this project',
    };
  }

  const identityValue = input.identityKey.slice(input.identityKey.indexOf(':') + 1);
  const aliasMatch = candidates.find(
    (c) => c.boardId === input.boardId && aliasesOf(c.props).includes(identityValue),
  );
  if (aliasMatch) {
    return { resolution: 'MERGE', match: aliasMatch, reason: 'value is a recorded alias' };
  }

  let best: { match: ExistingNodeMatch; similarity: number } | undefined;
  for (const candidate of candidates) {
    if (candidate.kind !== input.kind || candidate.boardId !== input.boardId) continue;
    const similarity = trigramSimilarity(candidate.title, input.display);
    if (similarity >= FUZZY_THRESHOLD && (best === undefined || similarity > best.similarity)) {
      best = { match: candidate, similarity };
    }
  }
  if (best) {
    return {
      resolution: 'CONFLICT',
      match: best.match,
      similarity: best.similarity,
      reason: 'possible duplicate of an existing node',
    };
  }

  return { resolution: 'NEW', reason: 'no existing node matches' };
}

function aliasesOf(props: Readonly<Record<string, unknown>>): readonly string[] {
  const raw = props.aliases;
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export type FieldDecision =
  | { readonly kind: 'skip'; readonly reason: 'identical' }
  | { readonly kind: 'set' }
  | { readonly kind: 'addToSet' }
  | {
      readonly kind: 'conflict';
      readonly defaultResolution: 'keep' | 'replace';
      readonly manual: boolean;
    };

export interface FieldMergeInput {
  readonly field: string;
  readonly current: unknown;
  readonly incoming: unknown;
  readonly currentConfidence?: number;
  readonly incomingConfidence: number;
  readonly props?: Readonly<Record<string, unknown>>;
}

/** Per-field merge semantics, exactly the table in §8.3. */
export function decideField(input: FieldMergeInput): FieldDecision {
  const { current, incoming } = input;
  if (isEmpty(current)) return { kind: 'set' };
  if (deepEqual(current, incoming)) return { kind: 'skip', reason: 'identical' };
  if (SET_FIELDS.has(input.field)) return { kind: 'addToSet' };

  const manual = wasManuallyEdited(input.props ?? {}, input.field);
  if (manual) return { kind: 'conflict', defaultResolution: 'keep', manual: true };

  const currentConfidence = input.currentConfidence ?? 0;
  const replace = input.incomingConfidence >= currentConfidence + 0.2;
  return { kind: 'conflict', defaultResolution: replace ? 'replace' : 'keep', manual: false };
}

export function wasManuallyEdited(
  props: Readonly<Record<string, unknown>>,
  field: string,
): boolean {
  const manual = props[MANUAL_EDIT_PROP];
  if (typeof manual !== 'object' || manual === null) return false;
  return (manual as Record<string, unknown>)[field] === true;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Postgres `pg_trgm`-compatible trigram similarity, so the client-side preview and the server-side
 * proposal build agree on which pairs cross 0.82. Postgres pads each word with two leading and one
 * trailing space; this reproduces that, including the word splitting on non-alphanumerics.
 */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 && right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

export function trigrams(input: string): Set<string> {
  const grams = new Set<string>();
  const words = input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
  for (const word of words) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) grams.add(padded.slice(i, i + 3));
  }
  return grams;
}
