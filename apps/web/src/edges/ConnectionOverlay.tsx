/**
 * The quick menu shown when a connection is dropped on empty canvas (P5 §5.3): "New note here and
 * connect" or "Cancel". Nothing is written until the analyst picks — a dropped connection that was
 * a slip of the hand must leave the board exactly as it was.
 */

import { Button } from '@nexus/ui';
import { useEffect, useRef } from 'react';

export interface ConnectionDrop {
  from: string;
  at: { x: number; y: number };
  /** Screen position of the drop, for placing the menu. */
  screen: { x: number; y: number };
}

export interface ConnectionOverlayProps {
  drop: ConnectionDrop | null;
  onCreate: (drop: ConnectionDrop) => void;
  onCancel: () => void;
}

export function ConnectionOverlay({ drop, onCreate, onCancel }: ConnectionOverlayProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (drop === null) return undefined;
    ref.current?.querySelector('button')?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drop, onCancel]);

  if (drop === null) return null;

  return (
    <div
      ref={ref}
      className="nx-context-menu"
      role="menu"
      aria-label="Finish connection"
      data-testid="connection-quick-menu"
      style={{
        position: 'fixed',
        insetInlineStart: `${String(drop.screen.x)}px`,
        insetBlockStart: `${String(drop.screen.y)}px`,
      }}
    >
      <Button onClick={() => onCreate(drop)}>New note here and connect</Button>
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
