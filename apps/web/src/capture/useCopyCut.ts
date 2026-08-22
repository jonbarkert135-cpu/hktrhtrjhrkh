/**
 * Ctrl/⌘+C and Ctrl/⌘+X for the canvas selection (roadmap §18).
 *
 * The clip is written to the system clipboard as plain JSON, so it survives a reload and can travel
 * to a second window; `usePaste` recognises it and re-creates the subgraph with fresh ids. Pastes
 * aimed at a text field are left to the field, exactly like `usePaste` does.
 */

import { copySubgraph, cutSubgraph, serializeClip, type ClipSource } from '@nexus/domain';
import { useCallback, useEffect } from 'react';
import type * as Y from 'yjs';

export interface CopyCutTarget {
  doc: Y.Doc;
  /** Current canvas selection; empty means "let the browser handle it". */
  selection: () => readonly string[];
  history?: { label(text: string): void; separate(): void } | undefined;
  now?: (() => string) | undefined;
  /** Stamped onto the clip so a paste into another board keeps the back-reference (§20). */
  source?: ClipSource | undefined;
}

export function useCopyCut(target: CopyCutTarget, onResult?: (message: string) => void): void {
  const handle = useCallback(
    (event: ClipboardEvent, cut: boolean): void => {
      if (isEditable(event.target) || event.clipboardData === null) return;
      const ids = target.selection();
      if (ids.length === 0) return;
      const now = (target.now ?? (() => new Date().toISOString()))();
      if (cut) target.history?.label('cut selection');
      const clip = cut
        ? cutSubgraph(target.doc, ids, { now, source: target.source })
        : copySubgraph(target.doc, [...ids], target.source);
      if (cut) target.history?.separate();
      if (clip.nodes.length === 0) return;
      event.clipboardData.setData('text/plain', serializeClip(clip));
      event.preventDefault();
      const count = clip.nodes.length;
      onResult?.(
        `${cut ? 'Cut' : 'Copied'} ${String(count)} node${count === 1 ? '' : 's'}` +
          (clip.edges.length > 0
            ? ` and ${String(clip.edges.length)} connection${clip.edges.length === 1 ? '' : 's'}`
            : ''),
      );
    },
    [target, onResult],
  );

  useEffect(() => {
    const onCopy = ((event: ClipboardEvent) => handle(event, false)) as EventListener;
    const onCut = ((event: ClipboardEvent) => handle(event, true)) as EventListener;
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
    };
  }, [handle]);
}

function isEditable(node: EventTarget | null): boolean {
  if (node === null || !(node instanceof HTMLElement)) return false;
  return node.isContentEditable || node.tagName === 'INPUT' || node.tagName === 'TEXTAREA';
}
