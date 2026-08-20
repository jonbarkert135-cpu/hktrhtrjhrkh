/**
 * Presence/awareness shaping (P8 §5.8/§5.9, 09_BACKEND.md §5.5). Awareness state itself is Yjs's
 * `awareness` protocol relayed by Hocuspocus; this module only validates/shapes the payload
 * (cap sizes, drop invalid fields) and provides the throttles and two-tab dedupe the UX needs.
 * Nothing here is persisted — awareness is never written to Postgres (P8 §7).
 *
 * Lives in `packages/domain` (not `apps/sync`) because both the sync service and the web client
 * need the exact same shaping/caps/throttle constants; `apps/sync/src/awareness.ts` re-exports it.
 */

export interface AwarenessState {
  userId: string;
  /** Distinguishes two tabs of the same user open on the same board (P8 edge case §8). */
  tabId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: readonly string[];
  viewport: { x: number; y: number; w: number; h: number } | null;
  activeNodeId: string | null;
}

export const CURSOR_HZ = 20;
export const VIEWPORT_HZ = 4;
export const CURSOR_INTERVAL_MS = 1000 / CURSOR_HZ;
export const VIEWPORT_INTERVAL_MS = 1000 / VIEWPORT_HZ;

/** 09_BACKEND.md §5.4: awareness payloads over 8 KB are dropped, not partially applied. */
export const AWARENESS_PAYLOAD_CAP_BYTES = 8 * 1024;

const MAX_SELECTION_IDS = 50;

/** True when a raw awareness payload should be dropped outright (P8 §9, §5.4). `TextEncoder` is
 * used instead of `Buffer` so this runs unmodified in the browser client and in `apps/sync`. */
export function exceedsAwarenessCap(raw: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(raw)).byteLength > AWARENESS_PAYLOAD_CAP_BYTES;
}

/**
 * Sanitizes an incoming awareness update: caps `selection`, strips anything that is not one of
 * the documented fields, and never lets a field carry an email or other PII (P8 §9: "presence
 * data exposes only display name and color").
 */
export function sanitizeAwareness(raw: Partial<AwarenessState>): AwarenessState {
  return {
    userId: String(raw.userId ?? ''),
    tabId: String(raw.tabId ?? ''),
    name: String(raw.name ?? '').slice(0, 200),
    color: String(raw.color ?? '#888888'),
    cursor:
      raw.cursor && Number.isFinite(raw.cursor.x) && Number.isFinite(raw.cursor.y)
        ? { x: raw.cursor.x, y: raw.cursor.y }
        : null,
    selection: Array.isArray(raw.selection) ? raw.selection.slice(0, MAX_SELECTION_IDS) : [],
    viewport: raw.viewport ?? null,
    activeNodeId: raw.activeNodeId ?? null,
  };
}

/** A simple leading-edge throttle: `true` when enough time passed to let the call through. */
export function createThrottle(intervalMs: number, now: () => number = Date.now) {
  let last = -Infinity;
  return (): boolean => {
    const t = now();
    if (t - last >= intervalMs) {
      last = t;
      return true;
    }
    return false;
  };
}

/** Key used to dedupe two tabs of the same user in the avatar stack (P8 edge case §8). */
export const awarenessKey = (userId: string, tabId: string): string => `${userId}:${tabId}`;

/** Collapses a room's raw client states into one entry per `userId+tabId`, latest wins. */
export function dedupeAwarenessClients(
  states: ReadonlyMap<number, AwarenessState>,
): AwarenessState[] {
  const byKey = new Map<string, AwarenessState>();
  for (const state of states.values()) {
    byKey.set(awarenessKey(state.userId, state.tabId), state);
  }
  return [...byKey.values()];
}

/** Distinct users present (ignoring tab duplicates) — what the avatar stack renders. */
export function distinctUsers(states: ReadonlyMap<number, AwarenessState>): AwarenessState[] {
  const seen = new Set<string>();
  const result: AwarenessState[] = [];
  for (const state of dedupeAwarenessClients(states)) {
    if (seen.has(state.userId)) continue;
    seen.add(state.userId);
    result.push(state);
  }
  return result;
}
