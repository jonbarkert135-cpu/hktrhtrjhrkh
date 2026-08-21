import { describe, expect, it, vi } from 'vitest';

import { sweep, type ReaperStore } from '../src/reaper.ts';

const NOW = Date.parse('2026-02-01T00:10:00.000Z');

function store(overrides: Partial<ReaperStore> = {}) {
  const failed: { runId: string; code: string }[] = [];
  const flagged: string[] = [];
  const base: ReaperStore = {
    listActiveRuns: () => Promise.resolve([]),
    listStuckParsing: () => Promise.resolve([]),
    failRun: (runId, code) => {
      failed.push({ runId, code });
      return Promise.resolve();
    },
    flagStaleParsing: (runId) => {
      flagged.push(runId);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { base, failed, flagged };
}

describe('reaper (§8 edge cases)', () => {
  it('marks a run failed with RUNNER_CRASHED when its container is gone', async () => {
    const { base, failed } = store({
      listActiveRuns: () =>
        Promise.resolve([
          {
            id: 'run-1',
            status: 'running',
            startedAt: new Date(NOW - 120_000),
            wallClockMs: 600_000,
          },
        ]),
    });
    const result = await sweep({
      store: base,
      liveContainers: () => Promise.resolve([]),
      killContainer: () => Promise.resolve(),
      now: () => NOW,
    });
    expect(result.failed).toEqual(['run-1']);
    expect(failed[0]?.code).toBe('RUNNER_CRASHED');
  });

  it('kills and times out a container that outlived its wall clock', async () => {
    const kill = vi.fn(() => Promise.resolve());
    const { base, failed } = store({
      listActiveRuns: () =>
        Promise.resolve([
          {
            id: 'run-2',
            status: 'running',
            startedAt: new Date(NOW - 600_000),
            wallClockMs: 60_000,
          },
        ]),
    });
    const result = await sweep({
      store: base,
      liveContainers: () => Promise.resolve(['run-2']),
      killContainer: kill,
      now: () => NOW,
    });
    expect(kill).toHaveBeenCalledWith('run-2');
    expect(failed[0]?.code).toBe('TIMEOUT');
    expect(result.killed).toContain('run-2');
  });

  it('kills orphaned containers with no active run row', async () => {
    const kill = vi.fn(() => Promise.resolve());
    const { base } = store();
    const result = await sweep({
      store: base,
      liveContainers: () => Promise.resolve(['orphan']),
      killContainer: kill,
      now: () => NOW,
    });
    expect(result.killed).toEqual(['orphan']);
  });

  it('flags runs stuck in parsing for over ten minutes', async () => {
    const { base, flagged } = store({
      listStuckParsing: () =>
        Promise.resolve([
          { id: 'run-3', status: 'parsing', startedAt: new Date(NOW - 900_000), wallClockMs: 0 },
        ]),
    });
    const result = await sweep({
      store: base,
      liveContainers: () => Promise.resolve([]),
      killContainer: () => Promise.resolve(),
      now: () => NOW,
    });
    expect(result.flagged).toEqual(['run-3']);
    expect(flagged).toEqual(['run-3']);
  });
});
