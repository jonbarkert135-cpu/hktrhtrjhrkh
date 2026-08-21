/**
 * Post-apply feedback (10_INTEGRATIONS.md §7.2 step 6): what was imported, Undo for ten seconds,
 * and a way back to the run that produced it. Mirrors `capture/PasteToast` on purpose — an import
 * from a tool and an import from the clipboard should feel like the same thing.
 */

import { Button } from '@nexus/ui';
import { useEffect } from 'react';

export const APPLY_TOAST_TIMEOUT_MS = 10_000;

export interface ApplyToastProps {
  result: { nodes: number; edges: number; integrationName: string } | null;
  onUndo: () => void;
  onViewRun: () => void;
  onDismiss: () => void;
}

export function ApplyToast({ result, onUndo, onViewRun, onDismiss }: ApplyToastProps) {
  useEffect(() => {
    if (result === null) return undefined;
    const timer = setTimeout(onDismiss, APPLY_TOAST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [result, onDismiss]);

  if (result === null) return null;

  return (
    <div className="nx-capture-toast" role="status" aria-live="polite" data-testid="apply-toast">
      <span>
        Imported {String(result.nodes)} nodes and {String(result.edges)} edges from{' '}
        {result.integrationName}
      </span>
      <Button size="sm" variant="secondary" onClick={onViewRun}>
        View run
      </Button>
      <Button size="sm" variant="secondary" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}
