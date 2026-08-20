/**
 * Client-side presence derived state (P8 §5.9, §6 UX). Wraps the shared awareness shaping from
 * `@nexus/domain` with the UI-only rules: cursor fade after 3 s idle, and follow mode.
 */

import { dedupeAwarenessClients, distinctUsers, type AwarenessState } from '@nexus/domain';

export const CURSOR_FADE_MS = 3_000;

export interface RemoteCursor {
  state: AwarenessState;
  /** True once `CURSOR_FADE_MS` has passed with no movement (P8 §6: "cursors fade after 3s"). */
  faded: boolean;
}

/** `lastMovedAt` is tracked per `userId+tabId` by the caller; this only decides fade, nothing else. */
export function remoteCursors(
  states: ReadonlyMap<number, AwarenessState>,
  lastMovedAt: ReadonlyMap<string, number>,
  now: number,
): RemoteCursor[] {
  return dedupeAwarenessClients(states)
    .filter((s) => s.cursor !== null)
    .map((state) => {
      const key = `${state.userId}:${state.tabId}`;
      const movedAt = lastMovedAt.get(key) ?? 0;
      return { state, faded: now - movedAt >= CURSOR_FADE_MS };
    });
}

/** The avatar stack: one entry per distinct user, tabs collapsed (P8 §5.9/edge case §8). */
export function avatarStack(states: ReadonlyMap<number, AwarenessState>): AwarenessState[] {
  return distinctUsers(states);
}

export interface FollowState {
  followingUserId: string | null;
}

export type FollowEvent =
  | { type: 'follow'; userId: string }
  | { type: 'unfollow' }
  | { type: 'local-pan' };

/** Following ends the moment the local user pans (P8 §6: "an obvious exit affordance"). */
export function reduceFollow(state: FollowState, event: FollowEvent): FollowState {
  switch (event.type) {
    case 'follow':
      return { followingUserId: event.userId };
    case 'unfollow':
    case 'local-pan':
      return { followingUserId: null };
    default:
      return state;
  }
}
