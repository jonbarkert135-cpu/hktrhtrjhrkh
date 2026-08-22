/**
 * Queue `github` — the five GitHub jobs of 11_GITHUB.md §10.
 *
 * One queue, one dispatcher: the job *name* selects a handler supplied by the caller, so the
 * fetching/analysis code stays in `packages/integrations` and this file only owns the run
 * lifecycle — including §10's rule that a cancelled job ends as `canceled`, never `failed`.
 */

import { toErrorPayload, type IntegrationErrorPayload } from '@nexus/integrations';
import type { GithubJobName, GithubJobPayload } from '@nexus/integrations/github/jobs';

export type GithubJobStatus = 'succeeded' | 'canceled' | 'failed';

export interface GithubJobStore {
  markSucceeded(runId: string): Promise<void>;
  markCanceled(runId: string): Promise<void>;
  markFailed(runId: string, payload: IntegrationErrorPayload): Promise<void>;
}

export type GithubHandlers = {
  [N in GithubJobName]: (payload: GithubJobPayload[N], signal: AbortSignal) => Promise<void>;
};

export interface GithubJobDeps {
  readonly handlers: GithubHandlers;
  readonly store: GithubJobStore;
}

export interface GithubJobOutcome {
  readonly status: GithubJobStatus;
  readonly error?: IntegrationErrorPayload;
}

/** True for the shapes `AbortController.abort()` produces across fetch/undici/Node. */
function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export async function processGithubJob<N extends GithubJobName>(
  deps: GithubJobDeps,
  name: N,
  payload: GithubJobPayload[N],
  runId: string,
  signal: AbortSignal,
): Promise<GithubJobOutcome> {
  if (signal.aborted) {
    await deps.store.markCanceled(runId);
    return { status: 'canceled' };
  }
  try {
    const handler = deps.handlers[name] as (
      p: GithubJobPayload[N],
      s: AbortSignal,
    ) => Promise<void>;
    await handler(payload, signal);
    await deps.store.markSucceeded(runId);
    return { status: 'succeeded' };
  } catch (error) {
    if (isAbort(error, signal)) {
      await deps.store.markCanceled(runId);
      return { status: 'canceled' };
    }
    const errorPayload = toErrorPayload(error, runId);
    await deps.store.markFailed(runId, errorPayload);
    return { status: 'failed', error: errorPayload };
  }
}
