import { describe, expect, it } from 'vitest';
import { parseGithubUrl } from '@nexus/domain';
import {
  GITHUB_JOB_SPECS,
  GITHUB_QUEUE,
  githubBackoff,
  githubJobId,
  githubJobOptions,
} from '../github/jobs.ts';

const ref = parseGithubUrl('https://github.com/sherlock-project/sherlock');
if (ref === null) throw new Error('fixture url must parse');

describe('github job specs (§10)', () => {
  it('uses one queue', () => {
    expect(GITHUB_QUEUE).toBe('github');
  });

  it('matches the spec table', () => {
    expect(GITHUB_JOB_SPECS['github.hydrate']).toEqual({
      concurrency: 8,
      attempts: 4,
      backoffMs: [2_000, 8_000, 30_000],
    });
    expect(GITHUB_JOB_SPECS['github.analyze'].concurrency).toBe(2);
    expect(GITHUB_JOB_SPECS['github.sweep']).toEqual({
      concurrency: 1,
      attempts: 1,
      backoffMs: [],
    });
  });
});

describe('githubJobId', () => {
  it('builds the documented idempotency keys', () => {
    expect(githubJobId('github.hydrate', { nodeId: 'n1', ref, boardId: 'b', userId: 'u' })).toBe(
      'hydrate:n1:gh:repo:sherlock-project/sherlock',
    );
    expect(githubJobId('github.tab', { nodeId: 'n1', tab: 'files' })).toBe('tab:n1:files');
    expect(
      githubJobId('github.analyze', {
        repoKey: 'sherlock-project/sherlock',
        headSha: 'abc',
        analyzerVersion: '1.0.0',
        userId: 'u',
        boardId: 'b',
      }),
    ).toBe('analyze:sherlock-project/sherlock:abc:1.0.0');
    expect(githubJobId('github.proposal', { analysisId: 'a1' })).toBe('proposal:a1');
    expect(githubJobId('github.sweep', { boardId: 'b1', hour: '2026-08-22T10' })).toBe(
      'sweep:b1:2026-08-22T10',
    );
  });

  it('is stable for the same payload', () => {
    const payload = { nodeId: 'n1', tab: 'readme' };
    expect(githubJobId('github.tab', payload)).toBe(githubJobId('github.tab', { ...payload }));
  });
});

describe('githubJobOptions', () => {
  it('dedupes by idempotency key and carries the retry count', () => {
    const options = githubJobOptions('github.proposal', { analysisId: 'a1' });
    expect(options.jobId).toBe('proposal:a1');
    expect(options.attempts).toBe(2);
    expect(options.backoff).toEqual({ type: 'custom' });
  });

  it('salts the id when the caller forces a re-run', () => {
    const options = githubJobOptions('github.tab', { nodeId: 'n1', tab: 'files', force: true }, 42);
    expect(options.jobId).toBe('tab:n1:files:force:42');
  });

  it('omits backoff for jobs that never retry', () => {
    const options = githubJobOptions('github.sweep', { boardId: 'b', hour: 'h' });
    expect(options.backoff).toBeUndefined();
    expect(options.attempts).toBe(1);
  });
});

describe('githubBackoff', () => {
  it('returns the documented delays per attempt', () => {
    expect(githubBackoff('github.hydrate', 1)).toBe(2_000);
    expect(githubBackoff('github.hydrate', 2)).toBe(8_000);
    expect(githubBackoff('github.hydrate', 3)).toBe(30_000);
  });

  it('clamps out-of-range attempts instead of returning zero', () => {
    expect(githubBackoff('github.hydrate', 99)).toBe(30_000);
    expect(githubBackoff('github.hydrate', 0)).toBe(2_000);
    expect(githubBackoff('github.sweep', 1)).toBe(0);
  });
});
