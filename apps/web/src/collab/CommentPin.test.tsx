import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CommentPin } from './CommentPin';

describe('CommentPin', () => {
  it('shows the unresolved count and opens the thread on click', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<CommentPin unresolvedCount={3} resolved={false} onOpen={onOpen} />);
    const pin = screen.getByTestId('comment-pin');
    expect(pin).toHaveTextContent('3');
    await user.click(pin);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows no badge once resolved', () => {
    render(<CommentPin unresolvedCount={0} resolved onOpen={vi.fn()} />);
    expect(screen.getByTestId('comment-pin')).toHaveAccessibleName('Resolved comment thread');
  });
});
