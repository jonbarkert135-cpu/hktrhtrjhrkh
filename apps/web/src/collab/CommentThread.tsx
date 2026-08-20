/**
 * The comment thread panel (P8 §5.10/§6): plain-text body with `@` mentions, `⌘/Ctrl+Enter`
 * submits, replies render newest-last. Mention suggestions are the caller's job (they need the
 * live project member list); this component only recognizes the `@token` being typed and reports
 * it via `onMentionQuery` so the host can render a suggestion list positioned by the caller.
 */

import { useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface CommentAuthor {
  id: string;
  name: string;
}

export interface CommentItem {
  id: string;
  author: CommentAuthor;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CommentThreadProps {
  comments: readonly CommentItem[];
  onSubmit: (body: string) => void;
  onResolve: (resolved: boolean) => void;
  resolved: boolean;
  onMentionQuery?: (query: string | null) => void;
}

function currentMentionQuery(value: string, caret: number): string | null {
  const upToCaret = value.slice(0, caret);
  const match = /@([a-zA-Z0-9_.-]*)$/.exec(upToCaret);
  return match ? (match[1] ?? '') : null;
}

export function CommentThread({
  comments,
  onSubmit,
  onResolve,
  resolved,
  onMentionQuery,
}: CommentThreadProps) {
  const [draft, setDraft] = useState('');

  const submit = (): void => {
    const body = draft.trim();
    if (!body) return;
    onSubmit(body);
    setDraft('');
    onMentionQuery?.(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section data-testid="comment-thread" aria-label="Comment thread">
      <button
        type="button"
        data-testid="resolve-toggle"
        aria-pressed={resolved}
        onClick={() => onResolve(!resolved)}
      >
        {resolved ? 'Reopen' : 'Resolve'}
      </button>

      <ol>
        {comments.map((comment) => (
          <li key={comment.id} data-testid={`comment-${comment.id}`}>
            <strong>{comment.author.name}</strong>
            <p>{comment.body}</p>
          </li>
        ))}
      </ol>

      <textarea
        data-testid="comment-composer"
        aria-label="Write a comment"
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          onMentionQuery?.(currentMentionQuery(next, event.target.selectionStart ?? next.length));
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        data-testid="comment-submit"
        onClick={submit}
        disabled={draft.trim().length === 0}
      >
        Comment
      </button>
    </section>
  );
}
