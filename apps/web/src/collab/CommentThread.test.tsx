import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CommentThread } from './CommentThread';

const comments = [
  { id: 'c1', author: { id: 'u1', name: 'Alex' }, body: 'first', createdAt: 't', resolvedAt: null },
];

describe('CommentThread', () => {
  it('lists comments and submits a new one', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <CommentThread
        comments={comments}
        onSubmit={onSubmit}
        onResolve={vi.fn()}
        resolved={false}
      />,
    );

    expect(screen.getByTestId('comment-c1')).toHaveTextContent('first');
    await user.type(screen.getByTestId('comment-composer'), 'hello @alex');
    await user.click(screen.getByTestId('comment-submit'));
    expect(onSubmit).toHaveBeenCalledWith('hello @alex');
  });

  it('⌘/Ctrl+Enter submits (P8 §6)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <CommentThread comments={[]} onSubmit={onSubmit} onResolve={vi.fn()} resolved={false} />,
    );
    await user.type(
      screen.getByTestId('comment-composer'),
      'quick note{Control>}{Enter}{/Control}',
    );
    expect(onSubmit).toHaveBeenCalledWith('quick note');
  });

  it('toggles resolve/reopen', async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(
      <CommentThread
        comments={comments}
        onSubmit={vi.fn()}
        onResolve={onResolve}
        resolved={false}
      />,
    );
    await user.click(screen.getByTestId('resolve-toggle'));
    expect(onResolve).toHaveBeenCalledWith(true);
  });

  it('reports the current @mention query as the caret moves', async () => {
    const onMentionQuery = vi.fn();
    const user = userEvent.setup();
    render(
      <CommentThread
        comments={[]}
        onSubmit={vi.fn()}
        onResolve={vi.fn()}
        resolved={false}
        onMentionQuery={onMentionQuery}
      />,
    );
    await user.type(screen.getByTestId('comment-composer'), 'hi @al');
    expect(onMentionQuery).toHaveBeenLastCalledWith('al');
  });
});
