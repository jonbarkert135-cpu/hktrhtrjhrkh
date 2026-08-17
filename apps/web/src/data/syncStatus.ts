/**
 * The save-indicator state machine (P3 §5.9, 03_UX.md §6). It ships now with local states only;
 * P8 adds the server states behind the same interface.
 *
 * The one rule that matters: the indicator must never show `Saved` while a write is pending.
 */

export type SyncState = 'saving' | 'saved' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Epoch ms of the last confirmed local write, or null when nothing has been saved yet. */
  lastSavedAt: number | null;
  /** Populated in the `error` state: what failed, in words the user can act on. */
  error: SyncError | null;
  /** True while the browser reports no connectivity; local writes continue regardless. */
  online: boolean;
  /** Number of writes the provider has not confirmed yet. */
  pending: number;
}

export interface SyncError {
  kind: 'quota' | 'unavailable' | 'unknown';
  message: string;
}

export type SyncEvent =
  | { type: 'write' }
  | { type: 'flushed'; at: number }
  | { type: 'online'; online: boolean }
  | { type: 'error'; error: SyncError }
  | { type: 'retry' };

export const initialSyncStatus = (online = true): SyncStatus => ({
  state: online ? 'saving' : 'offline',
  lastSavedAt: null,
  error: null,
  online,
  pending: 0,
});

export function reduceSync(status: SyncStatus, event: SyncEvent): SyncStatus {
  switch (event.type) {
    case 'write': {
      const pending = status.pending + 1;
      if (status.state === 'error') return { ...status, pending };
      return { ...status, pending, state: status.online ? 'saving' : 'offline' };
    }
    case 'flushed': {
      const pending = Math.max(0, status.pending - 1);
      if (status.state === 'error') return { ...status, pending, lastSavedAt: event.at };
      return {
        ...status,
        pending,
        lastSavedAt: event.at,
        // Still pending writes ⇒ never claim "Saved".
        state:
          pending > 0
            ? status.online
              ? 'saving'
              : 'offline'
            : status.online
              ? 'saved'
              : 'offline',
      };
    }
    case 'online': {
      if (status.state === 'error') return { ...status, online: event.online };
      if (!event.online) return { ...status, online: false, state: 'offline' };
      return {
        ...status,
        online: true,
        state: status.pending > 0 ? 'saving' : status.lastSavedAt === null ? 'saving' : 'saved',
      };
    }
    case 'error':
      return { ...status, state: 'error', error: event.error };
    case 'retry':
      return {
        ...status,
        state: status.online ? 'saving' : 'offline',
        error: null,
      };
    default:
      return status;
  }
}

/** Human label shown in the top bar. */
export function syncLabel(status: SyncStatus): string {
  switch (status.state) {
    case 'saved':
      return 'Saved';
    case 'saving':
      return 'Saving…';
    case 'offline':
      return 'Offline';
    case 'error':
      return 'Not saved';
    default:
      return 'Saving…';
  }
}

/** Tooltip text: the state plus when the last successful save happened. */
export function syncTooltip(status: SyncStatus, now: number): string {
  if (status.state === 'error') {
    return status.error?.message ?? 'This board could not be saved locally.';
  }
  if (status.lastSavedAt === null) {
    return status.state === 'offline'
      ? 'You are offline. Changes are kept on this device and saved locally.'
      : 'Saving this board to this device…';
  }
  const seconds = Math.max(0, Math.round((now - status.lastSavedAt) / 1000));
  const ago =
    seconds < 60
      ? `${String(seconds)} s ago`
      : seconds < 3600
        ? `${String(Math.round(seconds / 60))} min ago`
        : `${String(Math.round(seconds / 3600))} h ago`;
  const prefix = status.state === 'offline' ? 'Offline — saved locally' : 'Saved locally';
  return `${prefix} ${ago}`;
}

/** Maps a storage exception to an actionable error (P3 §8: quota, private mode). */
export function toSyncError(error: unknown): SyncError {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'QuotaExceededError' || /quota/i.test(message)) {
    return {
      kind: 'quota',
      message:
        'This device is out of storage, so the board could not be saved. Free some space, then retry — or export the board to a file now.',
    };
  }
  if (/indexeddb|not supported|private/i.test(message)) {
    return {
      kind: 'unavailable',
      message:
        'Local storage is unavailable (private browsing?). The board lives in memory only — export it to a file before closing this tab.',
    };
  }
  return { kind: 'unknown', message: `The board could not be saved locally: ${message}` };
}
