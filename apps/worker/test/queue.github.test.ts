/**
 * 11_GITHUB.md §10: dispatch, retry-visible failures and — the rule with teeth — cancellation
 * ending as `canceled` rather than `failed`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { IntegrationErrorPayload } from '@nexus/integrations';

import {
  processGithubJob,
  type GithubHandlers,
  type GithubJobStore,
} from '../src/queues/github.ts';

function store() {
  const calls: string[] = [];
  const failures: IntegrationErrorPayload[] = [];
  const impl: GithubJobStore = {
    markSucceeded: async (id) => void calls.push(`succeeded:${id}`),
    markCanceled: async (id) => void calls.push(`canceled:${id}`),
    markFailed: async (id, payload) => {
      calls.push(`failed:${id}`);
      failures.push(payload);
    },
  };
  return { impl, calls, failures };
}

function handlers(overrides: Partial<GithubHandlers> = {}): GithubHandlers {
  const noop = async () => {};
  return {
    'github.hydrate': noop,
    'github.tab': noop,
    'github.analyze': noop,
    'github.proposal': noop,
    'github.sweep': noop,
    ...overrides,
  };
}

describe('processGithubJob', () => {
  it('runs the handler for the job name and marks the run succeeded', async () => {
    const hydrate = vi.fn(async () => {});
    const s = store();
    const result = await processGithubJob(
      { handlers: handlers({ 'github.hydrate': hydrate }), store: s.impl },
      'github.hydrate',
      { nodeId: 'n1', ref: { kind: 'repo', owner: 'a', repo: 'b' }, boardId: 'b1', userId: 'u1' },
      'run-1',
      new AbortController().signal,
    );

    expect(result.status).toBe('succeeded');
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(s.calls).toEqual(['succeeded:run-1']);
  });

  it('passes the payload and the signal through to the handler', async () => {
    const controller = new AbortController();
    const seen: unknown[] = [];
    await processGithubJob(
      {
        handlers: handlers({
          'github.tab': async (payload, signal) => void seen.push(payload, signal),
        }),
        store: store().impl,
      },
      'github.tab',
      { nodeId: 'n1', tab: 'code', force: true },
      'run-2',
      controller.signal,
    );

    expect(seen[0]).toEqual({ nodeId: 'n1', tab: 'code', force: true });
    expect(seen[1]).toBe(controller.signal);
  });

  it('marks a run failed with a canonical error payload', async () => {
    const s = store();
    const result = await processGithubJob(
      {
        handlers: handlers({
          'github.analyze': async () => {
            throw new Error('clone exploded');
          },
        }),
        store: s.impl,
      },
      'github.analyze',
      {
        repoKey: 'gh:repo:a/b',
        headSha: 'deadbeef',
        analyzerVersion: '1.0.0',
        userId: 'u1',
        boardId: 'b1',
      },
      'run-3',
      new AbortController().signal,
    );

    expect(result.status).toBe('failed');
    expect(s.calls).toEqual(['failed:run-3']);
    expect(s.failures[0]?.code).toBeTypeOf('string');
  });

  it('never starts a job whose signal is already aborted', async () => {
    const handler = vi.fn(async () => {});
    const s = store();
    const controller = new AbortController();
    controller.abort();

    const result = await processGithubJob(
      { handlers: handlers({ 'github.proposal': handler }), store: s.impl },
      'github.proposal',
      { analysisId: 'an-1' },
      'run-4',
      controller.signal,
    );

    expect(result.status).toBe('canceled');
    expect(handler).not.toHaveBeenCalled();
    expect(s.calls).toEqual(['canceled:run-4']);
  });

  it('treats an aborted in-flight fetch as canceled, not failed', async () => {
    const s = store();
    const controller = new AbortController();

    const result = await processGithubJob(
      {
        handlers: handlers({
          'github.hydrate': async (_payload, signal) => {
            controller.abort();
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            expect(signal.aborted).toBe(true);
            throw error;
          },
        }),
        store: s.impl,
      },
      'github.hydrate',
      { nodeId: 'n1', ref: { kind: 'repo', owner: 'a', repo: 'b' }, boardId: 'b1', userId: 'u1' },
      'run-5',
      controller.signal,
    );

    expect(result.status).toBe('canceled');
    expect(s.calls).toEqual(['canceled:run-5']);
  });

  it('recognises an AbortError even when the signal object was replaced', async () => {
    const s = store();
    const result = await processGithubJob(
      {
        handlers: handlers({
          'github.sweep': async () => {
            const error = new Error('timed out');
            error.name = 'TimeoutError';
            throw error;
          },
        }),
        store: s.impl,
      },
      'github.sweep',
      { boardId: 'b1', hour: '2026-08-22T10' },
      'run-6',
      new AbortController().signal,
    );

    expect(result.status).toBe('canceled');
    expect(s.calls).toEqual(['canceled:run-6']);
  });
});
