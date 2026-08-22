/**
 * The save indicator and the undo/redo cluster (P3 §6, 03_UX.md §6). Always visible in the board
 * top bar: state, when the last local save happened, and what ⌘Z would revert.
 */

import { Button, VisuallyHidden } from '@nexus/ui';
import type { BoardHistory } from '@nexus/domain';

import { syncLabel, syncTooltip, type SyncStatus as Status } from '../../data/syncStatus.ts';
import { useHistoryState } from '../../data/docProvider.tsx';

export interface SyncStatusProps {
  status: Status;
  history: BoardHistory;
  /** Injected so the "3 s ago" copy is deterministic in tests. */
  now?: number;
  onRetry?: (() => void) | undefined;
  onExport?: (() => void) | undefined;
}

export function SyncStatus({
  status,
  history,
  now = Date.now(),
  onRetry,
  onExport,
}: SyncStatusProps) {
  const state = useHistoryState(history);
  const label = syncLabel(status);
  const tooltip = syncTooltip(status, now);

  return (
    <div className="nx-sync-cluster" role="group" aria-label="Document status">
      <span
        className="nx-sync-indicator"
        data-state={status.state}
        data-testid="sync-status"
        title={tooltip}
        aria-live="polite"
      >
        {label}
        <VisuallyHidden>. {tooltip}</VisuallyHidden>
      </span>

      {status.state === 'error' ? (
        <>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
          <Button variant="secondary" onClick={onExport}>
            Export to file
          </Button>
        </>
      ) : null}

      <Button
        variant="ghost"
        onClick={() => history.undo()}
        disabled={!state.canUndo}
        data-testid="history-undo"
        title={state.canUndo ? `Undo: ${state.undoLabel ?? 'last change'}` : 'Nothing to undo yet'}
        aria-label={state.canUndo ? `Undo: ${state.undoLabel ?? 'last change'}` : 'Undo'}
      >
        Undo
      </Button>
      <Button
        variant="ghost"
        onClick={() => history.redo()}
        disabled={!state.canRedo}
        title={state.canRedo ? `Redo: ${state.redoLabel ?? 'last change'}` : 'Nothing to redo'}
        aria-label={state.canRedo ? `Redo: ${state.redoLabel ?? 'last change'}` : 'Redo'}
      >
        Redo
      </Button>
    </div>
  );
}
