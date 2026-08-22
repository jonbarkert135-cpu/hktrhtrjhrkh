/**
 * Ghost preview of a layout proposal: where each card *would* go, drawn over the live board so the
 * analyst can compare before deciding. Nothing here writes to the document — this is the visual
 * half of the propose-never-write rule (N4, `00_MASTER.md` §3.3).
 *
 * The ghosts live in world space inside one container whose transform is updated imperatively on
 * `cameraChanged`. React never re-renders during a pan: that is the only way a 2,000-ghost preview
 * can survive N1.
 */

import type { Engine } from '@nexus/canvas-engine';
import type { LayoutDiff } from '@nexus/layout';
import { useEffect, useRef } from 'react';

/** Above this, individual ghosts stop being readable and cost more than they explain. */
export const MAX_GHOSTS = 600;

export interface LayoutGhostsProps {
  engine: Engine | null;
  diff: LayoutDiff | null;
}

export function LayoutGhosts({ engine, diff }: LayoutGhostsProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (engine === null || container === null) return undefined;
    const paint = (): void => {
      const { x, y, zoom } = engine.camera.state;
      container.style.transform = `scale(${String(zoom)}) translate(${String(-x)}px, ${String(-y)}px)`;
    };
    paint();
    return engine.on('cameraChanged', paint);
  }, [engine, diff]);

  if (diff === null || diff.moves.length === 0) return null;
  const shown = diff.moves.slice(0, MAX_GHOSTS);

  return (
    <div className="nx-layout-ghosts" data-testid="layout-ghosts" aria-hidden="true">
      <div ref={ref} className="nx-layout-ghost-world">
        {shown.map((move) => (
          <div key={move.id}>
            <div
              className="nx-layout-ghost nx-layout-ghost--from"
              style={{
                width: `${String(move.w)}px`,
                height: `${String(move.h)}px`,
                transform: `translate(${String(move.fromX)}px, ${String(move.fromY)}px)`,
              }}
            />
            <div
              className="nx-layout-ghost nx-layout-ghost--to"
              data-testid="layout-ghost-target"
              style={{
                width: `${String(move.w)}px`,
                height: `${String(move.h)}px`,
                transform: `translate(${String(move.x)}px, ${String(move.y)}px)`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
