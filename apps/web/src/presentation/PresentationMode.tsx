/**
 * §31 — presentation overlay. It is a dialog over the board: arrow keys or the on-screen controls
 * move between steps, Escape leaves, and every step reports its focus so the canvas can follow.
 */

import type { BoardEdge, BoardNode } from '@nexus/domain';
import { Button } from '@nexus/ui';
import { useEffect, useMemo, useState } from 'react';

import { buildDeck } from './deck.ts';

export interface PresentationModeProps {
  open: boolean;
  nodes: readonly BoardNode[];
  edges: readonly BoardEdge[];
  selectedIds: readonly string[];
  conclusion?: string | undefined;
  onClose: () => void;
  onFocus?: ((nodeIds: readonly string[]) => void) | undefined;
}

export function PresentationMode({
  open,
  nodes,
  edges,
  selectedIds,
  conclusion,
  onClose,
  onFocus,
}: PresentationModeProps) {
  const deck = useMemo(
    () =>
      buildDeck(nodes, edges, { selectedIds, ...(conclusion === undefined ? {} : { conclusion }) }),
    [nodes, edges, selectedIds, conclusion],
  );
  const [index, setIndex] = useState(0);
  const current = deck[Math.min(index, Math.max(deck.length - 1, 0))];

  useEffect(() => {
    if (!open) setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open || current === undefined) return;
    onFocus?.(current.focus);
  }, [open, current, onFocus]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') setIndex((value) => Math.min(value + 1, deck.length - 1));
      if (event.key === 'ArrowLeft') setIndex((value) => Math.max(value - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, deck.length, onClose]);

  if (!open) return null;

  return (
    <div className="nx-presentation" role="dialog" aria-modal="true" aria-label="Presentation">
      {current === undefined ? (
        <div className="nx-presentation-slide" data-testid="presentation-empty">
          <h2>Nothing to present</h2>
          <p className="nx-muted">
            Select the nodes that tell the story, or star them, then present.
          </p>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <div className="nx-presentation-slide" data-testid="presentation-slide">
          <p className="nx-muted">
            {String(Math.min(index, deck.length - 1) + 1)} / {String(deck.length)}
          </p>
          <h2 aria-live="polite">{current.title}</h2>
          <p>{current.body}</p>
          <div className="nx-inline">
            <Button
              variant="secondary"
              disabled={index === 0}
              onClick={() => setIndex((value) => Math.max(value - 1, 0))}
            >
              Back
            </Button>
            <Button
              data-testid="presentation-next"
              disabled={index >= deck.length - 1}
              onClick={() => setIndex((value) => Math.min(value + 1, deck.length - 1))}
            >
              Next
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Exit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
