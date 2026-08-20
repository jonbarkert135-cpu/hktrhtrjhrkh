/**
 * The avatar stack in the top bar, with follow mode (P8 §5.9/§6). Two tabs of the same user
 * collapse to one avatar (`avatarStack`); clicking an avatar starts following that user until any
 * local pan cancels it — the border tint and exit affordance are the "obvious exit" §6 asks for.
 */

import type { AwarenessState } from '@nexus/domain';

import type { FollowState } from '../data/presence.ts';

export interface PresenceLayerProps {
  users: readonly AwarenessState[];
  follow: FollowState;
  onFollow: (userId: string) => void;
  onUnfollow: () => void;
}

export function PresenceLayer({ users, follow, onFollow, onUnfollow }: PresenceLayerProps) {
  return (
    <div data-testid="presence-avatar-stack" aria-label="People on this board">
      {users.map((user) => {
        const isFollowing = follow.followingUserId === user.userId;
        return (
          <button
            key={user.userId}
            type="button"
            data-testid={`avatar-${user.userId}`}
            data-following={isFollowing}
            aria-pressed={isFollowing}
            title={isFollowing ? `Following ${user.name} — click to stop` : `Follow ${user.name}`}
            onClick={() => (isFollowing ? onUnfollow() : onFollow(user.userId))}
            style={{ borderColor: user.color, borderStyle: 'solid' }}
          >
            {user.name.slice(0, 1).toUpperCase()}
          </button>
        );
      })}
      {follow.followingUserId ? (
        <button type="button" data-testid="stop-following" onClick={onUnfollow}>
          Stop following
        </button>
      ) : null}
    </div>
  );
}
