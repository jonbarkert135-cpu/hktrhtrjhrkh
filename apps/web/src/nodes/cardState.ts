/**
 * Card state derivation (06_NODE_SYSTEM.md §3.2, P4 §5.12). One function, so the canvas card, the
 * inspector header and the tests all agree on what "this node is stale" means.
 */

import { builtinNodeTypes, type BoardNode } from '@nexus/domain';

export type CardState =
  | 'default'
  | 'loading'
  | 'error'
  | 'empty'
  | 'stale'
  | 'selected'
  | 'multi-selected'
  | 'dragging'
  | 'editing';

/** `fetchedAt` older than this shows the stale clock badge (P4 §5.12). */
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface CardContext {
  selected?: boolean;
  multiSelected?: boolean;
  dragging?: boolean;
  editing?: boolean;
  now?: number;
}

function requiredFieldMissing(node: BoardNode): boolean {
  const def = builtinNodeTypes().get(node.type);
  for (const field of def.inspector) {
    if (field.required !== true || !field.key.startsWith('data.')) continue;
    const value = node.data[field.key.slice('data.'.length)];
    if (value === undefined || value === null || value === '') return true;
  }
  return false;
}

function isStale(node: BoardNode, now: number): boolean {
  const fetchedAt = node.data['fetchedAt'];
  if (typeof fetchedAt !== 'string' || fetchedAt === '') return false;
  const parsed = Date.parse(fetchedAt);
  return !Number.isNaN(parsed) && now - parsed > STALE_AFTER_MS;
}

/**
 * Interaction states win over data states: while a card is being dragged or edited, telling the
 * user their data is stale is noise. Within the data states, an error outranks a missing field.
 */
export function cardStateOf(node: BoardNode, context: CardContext = {}): CardState {
  if (context.editing === true) return 'editing';
  if (context.dragging === true) return 'dragging';
  if (context.multiSelected === true) return 'multi-selected';
  if (context.selected === true) return 'selected';

  const enrichment = node.enrichment;
  const state = typeof enrichment['state'] === 'string' ? enrichment['state'] : 'idle';
  if (state === 'queued' || state === 'running') return 'loading';
  if (state === 'error' || node.data['uploadState'] === 'failed' || node.data['status'] === 'failed')
    return 'error';
  if (requiredFieldMissing(node)) return 'empty';
  if (isStale(node, context.now ?? Date.now())) return 'stale';
  return 'default';
}

/** The message an error card shows: what happened, and what the analyst can do about it. */
export function cardErrorMessage(node: BoardNode): string | null {
  const lastError = node.enrichment['lastError'];
  if (typeof lastError === 'string' && lastError !== '') return lastError;
  const uploadError = node.data['uploadError'];
  if (typeof uploadError === 'string' && uploadError !== '') return uploadError;
  if (node.data['status'] === 'failed') {
    const httpStatus = node.data['httpStatus'];
    return typeof httpStatus === 'number'
      ? `The page returned HTTP ${String(httpStatus)}. Open it manually or retry.`
      : 'The page could not be fetched. Open it manually or retry.';
  }
  return null;
}

/** `2026-01-01T…` → `3 days ago`, for the "fetched N ago" footnote. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  const seconds = Math.round((now - parsed) / 1000);
  if (seconds < 60) return 'just now';
  const units: Array<[number, string]> = [
    [60, 'minute'],
    [3600, 'hour'],
    [86_400, 'day'],
    [2_592_000, 'month'],
    [31_536_000, 'year'],
  ];
  let unit: [number, string] = units[0] as [number, string];
  for (const candidate of units) if (seconds >= candidate[0]) unit = candidate;
  const value = Math.floor(seconds / unit[0]);
  return `${String(value)} ${unit[1]}${value === 1 ? '' : 's'} ago`;
}
