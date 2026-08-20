import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PresenceLayer } from './PresenceLayer';
import type { AwarenessState } from '@nexus/domain';

function user(id: string, name: string): AwarenessState {
  return {
    userId: id,
    tabId: 't',
    name,
    color: '#fff',
    cursor: null,
    selection: [],
    viewport: null,
    activeNodeId: null,
  };
}

describe('PresenceLayer', () => {
  it('renders one avatar per distinct user and follows on click', async () => {
    const onFollow = vi.fn();
    const onUnfollow = vi.fn();
    const client = userEvent.setup();
    render(
      <PresenceLayer
        users={[user('u1', 'Alex'), user('u2', 'Sam')]}
        follow={{ followingUserId: null }}
        onFollow={onFollow}
        onUnfollow={onUnfollow}
      />,
    );
    expect(screen.getAllByTestId(/^avatar-/)).toHaveLength(2);
    await client.click(screen.getByTestId('avatar-u2'));
    expect(onFollow).toHaveBeenCalledWith('u2');
  });

  it('shows a stop-following affordance while following (P8 §6)', () => {
    render(
      <PresenceLayer
        users={[user('u1', 'Alex')]}
        follow={{ followingUserId: 'u1' }}
        onFollow={vi.fn()}
        onUnfollow={vi.fn()}
      />,
    );
    expect(screen.getByTestId('stop-following')).toBeInTheDocument();
    expect(screen.getByTestId('avatar-u1')).toHaveAttribute('aria-pressed', 'true');
  });
});
