/**
 * Capture feedback (P6 §6): one line saying what happened, an Undo for 8 seconds, and — when a
 * paste was capped at 50 URLs — the offer to import the rest as a list instead.
 */

import { Button } from '@nexus/ui';
import { useEffect } from 'react';

export const TOAST_TIMEOUT_MS = 8000;

export interface PasteToastProps {
  message: string | null;
  onUndo: (() => void) | null;
  onImportList: (() => void) | null;
  onDismiss: () => void;
}

export function PasteToast({ message, onUndo, onImportList, onDismiss }: PasteToastProps) {
  useEffect(() => {
    if (message === null) return undefined;
    const timer = setTimeout(onDismiss, TOAST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (message === null) return null;

  return (
    <div className="nx-capture-toast" role="status" aria-live="polite" data-testid="capture-toast">
      <span>{message}</span>
      {onImportList !== null ? (
        <Button size="sm" variant="secondary" onClick={onImportList}>
          Import as a list
        </Button>
      ) : null}
      {onUndo !== null ? (
        <Button size="sm" variant="secondary" onClick={onUndo}>
          Undo
        </Button>
      ) : null}
    </div>
  );
}
