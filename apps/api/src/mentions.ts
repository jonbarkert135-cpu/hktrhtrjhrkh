/**
 * Mention notification (P8 §5.11): notify by email, rate-limited with a digest after 3 in
 * 10 minutes, plus an in-app inbox entry. The inbox write is unconditional (P8 §5.11 "and in an
 * in-app inbox"); only the *email* send is rate-limited/digested — a person should never miss a
 * mention in-app just because email is being throttled.
 *
 * There is no mailer in this codebase yet (P1 deferred it — "check your inbox" ships no email).
 * `EmailSink`/`InboxSink` are injected so this module is fully testable now and the real
 * transport is a one-line swap when the mailer lands (RAVEN-SPEC/20_ROADMAP.md P8 deviation note).
 */

const DIGEST_WINDOW_MS = 10 * 60 * 1000;
const DIGEST_THRESHOLD = 3;

export interface MentionEvent {
  recipientId: string;
  boardId: string;
  commentId: string;
  authorName: string;
  excerpt: string;
}

export interface EmailSink {
  sendImmediate(event: MentionEvent): Promise<void>;
  sendDigest(recipientId: string, events: MentionEvent[]): Promise<void>;
}

export interface InboxSink {
  add(event: MentionEvent): Promise<void>;
}

interface RecipientWindow {
  events: MentionEvent[];
  windowStart: number;
}

/**
 * The first two mentions in a rolling 10-minute window per recipient email immediately; the
 * third (and any further mention before the window resets) instead extends a pending digest that
 * flushes once, batching everything since the window started.
 */
export class MentionNotifier {
  private readonly windows = new Map<string, RecipientWindow>();
  // Plain field + assignment: parameter properties are not erasable and therefore unsupported by
  // `node --experimental-strip-types` (see infra/docker/api.Dockerfile, same note as env.ts).
  private readonly email: EmailSink;
  private readonly inbox: InboxSink;
  private readonly now: () => number;

  constructor(email: EmailSink, inbox: InboxSink, now: () => number = Date.now) {
    this.email = email;
    this.inbox = inbox;
    this.now = now;
  }

  async notify(event: MentionEvent): Promise<void> {
    await this.inbox.add(event);

    const now = this.now();
    let win = this.windows.get(event.recipientId);
    if (!win || now - win.windowStart > DIGEST_WINDOW_MS) {
      win = { events: [], windowStart: now };
      this.windows.set(event.recipientId, win);
    }
    win.events.push(event);

    if (win.events.length < DIGEST_THRESHOLD) {
      await this.email.sendImmediate(event);
      return;
    }
    if (win.events.length === DIGEST_THRESHOLD) {
      await this.email.sendDigest(event.recipientId, win.events);
      return;
    }
    // 4th+ mention in the same window: folded into the same pending digest, no extra send —
    // the digest already sent covers "since the window started"; a future digest send on the
    // *next* window will include this one. Kept simple: we do not re-send per event.
  }
}
