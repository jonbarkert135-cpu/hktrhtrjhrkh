import { describe, expect, it } from 'vitest';

import { avatarStack, CURSOR_FADE_MS, reduceFollow, remoteCursors } from './presence';
import type { AwarenessState } from '@nexus/domain';

function state(overrides: Partial<AwarenessState> = {}): AwarenessState {
  return {
    userId: 'u1',
    tabId: 't1',
    name: 'Alex',
    color: '#fff',
    cursor: { x: 1, y: 2 },
    selection: [],
    viewport: null,
    activeNodeId: null,
    ...overrides,
  };
}

describe('remoteCursors', () => {
  it('fades a cursor after 3s of inactivity (P8 §6)', () => {
    const states = new Map([[1, state()]]);
    const lastMovedAt = new Map([['u1:t1', 0]]);
    expect(remoteCursors(states, lastMovedAt, 1_000)[0]?.faded).toBe(false);
    expect(remoteCursors(states, lastMovedAt, CURSOR_FADE_MS)[0]?.faded).toBe(true);
  });

  it('drops clients with no cursor', () => {
    const states = new Map([[1, state({ cursor: null })]]);
    expect(remoteCursors(states, new Map(), 0)).toHaveLength(0);
  });
});

describe('avatarStack', () => {
  it('collapses two tabs of the same user into one avatar', () => {
    const states = new Map([
      [1, state({ tabId: 'ta' })],
      [2, state({ tabId: 'tb' })],
      [3, state({ userId: 'u2', tabId: 'tc' })],
    ]);
    expect(avatarStack(states)).toHaveLength(2);
  });
});

describe('reduceFollow', () => {
  it('follows a user, then exits on any local pan', () => {
    let f = reduceFollow({ followingUserId: null }, { type: 'follow', userId: 'u2' });
    expect(f.followingUserId).toBe('u2');
    f = reduceFollow(f, { type: 'local-pan' });
    expect(f.followingUserId).toBeNull();
  });

  it('unfollow explicitly clears the state', () => {
    const f = reduceFollow({ followingUserId: 'u2' }, { type: 'unfollow' });
    expect(f.followingUserId).toBeNull();
  });
});
