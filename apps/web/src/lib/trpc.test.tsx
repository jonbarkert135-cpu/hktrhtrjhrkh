import { TRPCClientError } from '@trpc/client';
import { describe, expect, it, vi } from 'vitest';

// The provider needs a live tRPC client; only the pure copy helpers are unit-tested here.
vi.mock('./auth', () => ({ API_URL: 'http://localhost:3000' }));

import { errorCode, errorMessage } from './trpc';

function clientError(data: unknown): TRPCClientError<never> {
  // ponytail: the constructor's result shape is heavily generic; `data` is all these helpers read.
  return Object.assign(new TRPCClientError<never>('boom'), { data });
}

describe('errorCode', () => {
  it('reads the tRPC error code', () => {
    expect(errorCode(clientError({ code: 'NOT_FOUND' }))).toBe('NOT_FOUND');
  });

  it('is undefined for a non-tRPC error, a missing shape and a non-string code', () => {
    expect(errorCode(new Error('nope'))).toBeUndefined();
    expect(errorCode(clientError(undefined))).toBeUndefined();
    expect(errorCode(clientError({ code: 500 }))).toBeUndefined();
  });
});

describe('errorMessage', () => {
  it.each([
    ['UNAUTHORIZED', 'Your session ended. Sign in again to continue — your work is not lost.'],
    ['FORBIDDEN', "You don't have access to this. Ask a project admin for the Analyst role."],
    ['NOT_FOUND', 'That item no longer exists. It may have been deleted or moved.'],
    ['TIMEOUT', 'The server took too long to answer. Check your connection and try again.'],
    ['CONFLICT', 'Someone else changed this first. Reload to see the current version.'],
    ['TOO_MANY_REQUESTS', 'Too many attempts. Wait a minute, then try again.'],
    ['BAD_REQUEST', "That request wasn't valid. Check the highlighted fields and try again."],
    ['PAYLOAD_TOO_LARGE', 'That file is too large. Try a smaller file.'],
    [
      'INTERNAL_SERVER_ERROR',
      "The server couldn't complete that. Try again — nothing was changed.",
    ],
  ])('maps %s to its sentence', (code, copy) => {
    expect(errorMessage(clientError({ code }))).toBe(copy);
  });

  it('falls back for an unknown code and for a plain error', () => {
    const fallback = "That didn't work. Try again — nothing was changed.";
    expect(errorMessage(clientError({ code: 'TEAPOT' }))).toBe(fallback);
    expect(errorMessage(new Error('nope'))).toBe(fallback);
  });
});
