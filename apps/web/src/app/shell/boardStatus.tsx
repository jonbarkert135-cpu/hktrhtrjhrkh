/**
 * The status bar is part of the shell, but the numbers it shows belong to the board. This is the
 * one-way channel between them: the board publishes what it knows, the status bar reads it, and
 * nothing renders a hard-coded "0 nodes" placeholder (04_DESIGN_SYSTEM.md P5 — every state is
 * designed, including the empty one).
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface BoardStatus {
  /** `null` while no board is open — the status bar then says so instead of showing zeros. */
  readonly counts: { readonly nodes: number; readonly edges: number } | null;
  /** Short, user-facing persistence state, e.g. "Saved locally". */
  readonly persistence: string;
}

export interface BoardStatusApi extends BoardStatus {
  readonly publish: (next: Partial<BoardStatus>) => void;
}

const EMPTY: BoardStatus = { counts: null, persistence: 'Saved locally' };

const Context = createContext<BoardStatusApi>({ ...EMPTY, publish: () => undefined });

export function BoardStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BoardStatus>(EMPTY);
  const api = useMemo<BoardStatusApi>(
    () => ({
      ...status,
      publish: (next: Partial<BoardStatus>) => {
        setStatus((current) => {
          const merged = { ...current, ...next };
          const sameCounts =
            merged.counts === current.counts ||
            (merged.counts !== null &&
              current.counts !== null &&
              merged.counts.nodes === current.counts.nodes &&
              merged.counts.edges === current.counts.edges);
          if (sameCounts && merged.persistence === current.persistence) return current;
          return merged;
        });
      },
    }),
    [status],
  );
  return <Context.Provider value={api}>{children}</Context.Provider>;
}

export function useBoardStatus(): BoardStatusApi {
  return useContext(Context);
}
