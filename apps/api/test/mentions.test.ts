/**
 * P8 §5.11: mentions notify by email, rate-limited (digest after 3 in 10 minutes) and
 * unconditionally in an in-app inbox.
 */

import { describe, expect, it, vi } from 'vitest';

import { MentionNotifier, type MentionEvent } from '../src/mentions.ts';

function event(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    recipientId: 'u1',
    boardId: 'b1',
    commentId: 'c1',
    authorName: 'Alex',
    excerpt: 'hi',
    ...overrides,
  };
}

describe('MentionNotifier', () => {
  it('the first two mentions in the window email immediately', async () => {
    let t = 0;
    const email = {
      sendImmediate: vi.fn().mockResolvedValue(undefined),
      sendDigest: vi.fn().mockResolvedValue(undefined),
    };
    const inbox = { add: vi.fn().mockResolvedValue(undefined) };
    const notifier = new MentionNotifier(email, inbox, () => t);

    await notifier.notify(event({ commentId: 'c1' }));
    await notifier.notify(event({ commentId: 'c2' }));

    expect(email.sendImmediate).toHaveBeenCalledTimes(2);
    expect(email.sendDigest).not.toHaveBeenCalled();
    expect(inbox.add).toHaveBeenCalledTimes(2);
  });

  it('the third mention in the window sends one digest instead of an immediate email', async () => {
    let t = 0;
    const email = {
      sendImmediate: vi.fn().mockResolvedValue(undefined),
      sendDigest: vi.fn().mockResolvedValue(undefined),
    };
    const inbox = { add: vi.fn().mockResolvedValue(undefined) };
    const notifier = new MentionNotifier(email, inbox, () => t);

    await notifier.notify(event({ commentId: 'c1' }));
    await notifier.notify(event({ commentId: 'c2' }));
    await notifier.notify(event({ commentId: 'c3' }));

    expect(email.sendImmediate).toHaveBeenCalledTimes(2);
    expect(email.sendDigest).toHaveBeenCalledTimes(1);
    expect(email.sendDigest.mock.calls[0]?.[1]).toHaveLength(3);
  });

  it('a mention outside the 10-minute window starts a fresh count', async () => {
    let t = 0;
    const email = {
      sendImmediate: vi.fn().mockResolvedValue(undefined),
      sendDigest: vi.fn().mockResolvedValue(undefined),
    };
    const inbox = { add: vi.fn().mockResolvedValue(undefined) };
    const notifier = new MentionNotifier(email, inbox, () => t);

    await notifier.notify(event({ commentId: 'c1' }));
    t += 11 * 60 * 1000;
    await notifier.notify(event({ commentId: 'c2' }));

    expect(email.sendImmediate).toHaveBeenCalledTimes(2);
    expect(email.sendDigest).not.toHaveBeenCalled();
  });

  it('different recipients get independent windows', async () => {
    const email = {
      sendImmediate: vi.fn().mockResolvedValue(undefined),
      sendDigest: vi.fn().mockResolvedValue(undefined),
    };
    const inbox = { add: vi.fn().mockResolvedValue(undefined) };
    const notifier = new MentionNotifier(email, inbox, () => 0);

    await notifier.notify(event({ recipientId: 'u1' }));
    await notifier.notify(event({ recipientId: 'u2' }));
    await notifier.notify(event({ recipientId: 'u1' }));

    expect(email.sendImmediate).toHaveBeenCalledTimes(3);
  });
});
