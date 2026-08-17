/**
 * Version history (P3 §5.10, §6). Lists local snapshots with relative time and node/edge counts,
 * previews one read-only on the canvas, and restores it as a normal — therefore undoable —
 * operation.
 */

import { Banner, Button, Dialog } from '@nexus/ui';
import { useCallback, useEffect, useState } from 'react';

import type { SnapshotStore, SnapshotSummary } from '../../data/snapshots.ts';

export interface VersionHistoryProps {
  open: boolean;
  boardId: string;
  store: SnapshotStore;
  onOpenChange: (open: boolean) => void;
  onPreview: (id: string) => void;
  onRestore: (id: string) => void;
  /** Injected for deterministic relative times in tests. */
  now?: number;
  previewingId?: string | null;
}

export function relativeTime(from: number, to: number): string {
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${String(seconds)} s ago`;
  if (seconds < 3600) return `${String(Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${String(Math.round(seconds / 3600))} h ago`;
  return `${String(Math.round(seconds / 86_400))} d ago`;
}

export function VersionHistory({
  open,
  boardId,
  store,
  onOpenChange,
  onPreview,
  onRestore,
  now = Date.now(),
  previewingId = null,
}: VersionHistoryProps) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    store
      .list(boardId)
      .then((records) => {
        setSnapshots(records);
        setError(null);
      })
      .catch(() => setError('Version history could not be read from this device.'));
  }, [store, boardId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Version history"
      description="Local snapshots of this board. Restoring adds a new step — it never rewrites history."
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      {error ? (
        <Banner kind="danger" title="Couldn't load versions">
          {error}
        </Banner>
      ) : null}
      {previewingId !== null ? (
        <Banner kind="info" title="You are previewing a version">
          The canvas shows a past version read-only. Restore it, or close this panel to go back.
        </Banner>
      ) : null}
      {snapshots.length === 0 && error === null ? (
        <p className="nx-muted">
          No snapshots yet. One is written automatically every 200 changes or every five minutes.
        </p>
      ) : null}
      <ul className="nx-stack" data-testid="version-list">
        {snapshots.map((snapshot) => (
          <li key={snapshot.id} className="nx-row">
            <span>
              {relativeTime(snapshot.createdAt, now)} — {String(snapshot.nodeCount)} nodes,{' '}
              {String(snapshot.edgeCount)} edges
              {snapshot.reason === 'auto' ? '' : ` (${snapshot.reason})`}
            </span>
            <Button variant="ghost" onClick={() => onPreview(snapshot.id)}>
              Preview
            </Button>
            <Button onClick={() => onRestore(snapshot.id)}>Restore this version</Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
