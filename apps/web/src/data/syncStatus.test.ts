import { describe, expect, it } from 'vitest';

import {
  initialSyncStatus,
  reduceSync,
  syncLabel,
  syncTooltip,
  toSyncError,
  type SyncStatus,
} from './syncStatus';

const T = 1_800_000_000_000;

const run = (start: SyncStatus, events: Parameters<typeof reduceSync>[1][]): SyncStatus =>
  events.reduce(reduceSync, start);

describe('sync status machine', () => {
  it('never reports Saved while a write is pending', () => {
    const status = run(initialSyncStatus(), [
      { type: 'write' },
      { type: 'write' },
      { type: 'flushed', at: T },
    ]);
    expect(status.pending).toBe(1);
    expect(status.state).toBe('saving');
    expect(syncLabel(reduceSync(status, { type: 'flushed', at: T }))).toBe('Saved');
  });

  it('stays offline while writes keep flushing locally', () => {
    const offline = run(initialSyncStatus(false), [{ type: 'write' }, { type: 'flushed', at: T }]);
    expect(offline.state).toBe('offline');
    expect(offline.lastSavedAt).toBe(T);
    const back = reduceSync(offline, { type: 'online', online: true });
    expect(back.state).toBe('saved');
  });

  it('goes back to saving when connectivity returns with pending writes', () => {
    const status = run(initialSyncStatus(), [
      { type: 'online', online: false },
      { type: 'write' },
      { type: 'online', online: true },
    ]);
    expect(status.state).toBe('saving');
  });

  it('shows saving again when connectivity returns before the first save', () => {
    const status = run(initialSyncStatus(), [
      { type: 'online', online: false },
      { type: 'online', online: true },
    ]);
    expect(status.state).toBe('saving');
  });

  it('keeps the error state sticky until retry', () => {
    const failed = run(initialSyncStatus(), [
      { type: 'error', error: { kind: 'quota', message: 'full' } },
      { type: 'write' },
      { type: 'flushed', at: T },
      { type: 'online', online: false },
    ]);
    expect(failed.state).toBe('error');
    expect(syncLabel(failed)).toBe('Not saved');
    const retried = reduceSync(failed, { type: 'retry' });
    expect(retried.state).toBe('offline');
    expect(retried.error).toBeNull();
  });

  it('ignores unknown events', () => {
    const status = initialSyncStatus();
    expect(reduceSync(status, { type: 'nope' } as never)).toBe(status);
  });

  it('writes a tooltip with the age of the last save', () => {
    const base = initialSyncStatus();
    expect(syncTooltip(base, T)).toMatch(/Saving this board/);
    expect(syncTooltip({ ...base, state: 'offline' }, T)).toMatch(/You are offline/);
    expect(syncTooltip({ ...base, state: 'saved', lastSavedAt: T - 3_000 }, T)).toBe(
      'Saved locally 3 s ago',
    );
    expect(syncTooltip({ ...base, state: 'saved', lastSavedAt: T - 120_000 }, T)).toBe(
      'Saved locally 2 min ago',
    );
    expect(syncTooltip({ ...base, state: 'offline', lastSavedAt: T - 7_200_000 }, T)).toBe(
      'Offline — saved locally 2 h ago',
    );
    expect(
      syncTooltip({ ...base, state: 'error', error: { kind: 'quota', message: 'no space' } }, T),
    ).toBe('no space');
    expect(syncTooltip({ ...base, state: 'error' }, T)).toMatch(/could not be saved/);
  });

  it('labels every state', () => {
    const base = initialSyncStatus();
    expect(
      ['saved', 'saving', 'offline', 'error'].map((state) =>
        syncLabel({ ...base, state: state as SyncStatus['state'] }),
      ),
    ).toEqual(['Saved', 'Saving…', 'Offline', 'Not saved']);
    expect(syncLabel({ ...base, state: 'weird' as SyncStatus['state'] })).toBe('Saving…');
  });

  it('maps storage exceptions to actionable errors', () => {
    const quota = new Error('boom');
    quota.name = 'QuotaExceededError';
    expect(toSyncError(quota).kind).toBe('quota');
    expect(toSyncError(new Error('IndexedDB is not supported')).kind).toBe('unavailable');
    expect(toSyncError('weird failure').kind).toBe('unknown');
  });
});
