/**
 * Comment threads (P8 §5.10, §6, §9). Stored in Postgres, not the CRDT — the doc only carries the
 * anchor id in its `comments` Y.Map (`doc/schema.ts`) so a pin moves with its node without a round
 * trip to the API; the thread body, author and resolution state live here because they need
 * server-side notification and permission queries.
 */

import { z } from 'zod';

import { IsoDateSchema } from './provenance.ts';

/** P8 §9: comment bodies are plain text, length-capped at 8,000 chars. */
export const COMMENT_BODY_MAX_LENGTH = 8_000;

export const CommentAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), nodeId: z.string().min(1) }),
  z.object({ kind: z.literal('point'), x: z.number().finite(), y: z.number().finite() }),
]);
export type CommentAnchor = z.infer<typeof CommentAnchorSchema>;

export const CommentSchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  parentId: z.string().nullable().default(null),
  anchor: CommentAnchorSchema,
  body: z.string().min(1).max(COMMENT_BODY_MAX_LENGTH),
  authorId: z.string().min(1),
  resolvedAt: IsoDateSchema.nullable().default(null),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type BoardComment = z.infer<typeof CommentSchema>;

/**
 * `@handle` mentions, resolved server-side against actual project members (P8 §9 — "no arbitrary
 * email injection"). This only extracts the raw handles from the text; resolving a handle to a
 * real member id is the router's job because it needs the membership list.
 */
const MENTION_RE = /(^|[\s(])@([a-zA-Z0-9_.-]{1,64})/g;

export function extractMentionHandles(body: string): string[] {
  const handles = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) {
    const handle = match[2];
    if (handle) handles.add(handle.toLowerCase());
  }
  return [...handles];
}
