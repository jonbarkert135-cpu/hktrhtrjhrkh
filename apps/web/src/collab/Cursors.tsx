/**
 * Remote cursors (P8 §6/§9). Calm by design: a label only appears on movement/hover, and the
 * whole cursor fades after 3 s of inactivity (`presence.ts`'s `remoteCursors`). Board-coordinate
 * to screen-coordinate conversion is the caller's job — this component only lays out what it is
 * given, so it stays independent of the canvas engine's camera (00_MASTER.md §5 layering).
 */

import type { RemoteCursor } from '../data/presence.ts';

export interface CursorsProps {
  cursors: readonly RemoteCursor[];
  /** Board -> screen coordinate transform, owned by the canvas camera. */
  toScreen: (point: { x: number; y: number }) => { x: number; y: number };
}

export function Cursors({ cursors, toScreen }: CursorsProps) {
  return (
    <div aria-hidden="true" data-testid="remote-cursors">
      {cursors.map(({ state, faded }) => {
        if (!state.cursor) return null;
        const { x, y } = toScreen(state.cursor);
        return (
          <div
            key={`${state.userId}:${state.tabId}`}
            data-testid={`cursor-${state.userId}`}
            data-faded={faded}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              opacity: faded ? 0 : 1,
              color: state.color,
              pointerEvents: 'none',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M2 1l11 6-5 1.5L6 14z" />
            </svg>
            {!faded ? <span data-testid={`cursor-label-${state.userId}`}>{state.name}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
