/**
 * Drag-and-drop capture (P6 §5.5, §5.6): OS files, an image or link dragged from another tab, and
 * a link dragged out of the address bar. The overlay it drives is a full-canvas dashed outline that
 * says what is being dropped and where it will land.
 *
 * `dragover` fires continuously, so the state it writes is the *summary string only* — the pointer
 * position is kept in a ref and read on drop, never rendered.
 */

import { useCallback, useRef, useState } from 'react';

import {
  captureTransfer,
  snapshotTransfer,
  type CaptureResult,
  type CaptureTarget,
} from './usePaste.ts';

export interface DropState {
  active: boolean;
  /** "3 files", "1 image", "Link" — what the overlay tells the user is coming. */
  summary: string;
}

export interface DropZone {
  state: DropState;
  /** Screen point of the last drag event, for the insertion indicator. */
  pointer: { x: number; y: number } | null;
  handlers: {
    onDragOver: (event: React.DragEvent) => void;
    onDragLeave: (event: React.DragEvent) => void;
    onDrop: (event: React.DragEvent) => void;
  };
}

/** Summarises a drag from `DataTransfer.items`, which is all a browser exposes before the drop. */
export function summarizeDrag(data: DataTransfer | null): string {
  if (data === null) return 'Item';
  const items = Array.from(data.items ?? []).filter((item) => item.kind === 'file');
  if (items.length > 0) {
    const images = items.filter((item) => item.type.startsWith('image/')).length;
    const noun = images === items.length ? 'image' : 'file';
    return `${String(items.length)} ${noun}${items.length === 1 ? '' : 's'}`;
  }
  const types = Array.from(data.types ?? []);
  if (types.includes('text/uri-list')) return 'Link';
  if (types.includes('text/html') || types.includes('text/plain')) return 'Text';
  return 'Item';
}

export function useDropZone(
  target: CaptureTarget,
  onResult: (result: CaptureResult) => void,
): DropZone {
  const [state, setState] = useState<DropState>({ active: false, summary: '' });
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // Entering a child element fires `dragleave` on the parent; counting keeps the overlay stable.
  const depth = useRef(0);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
    pointer.current = { x: event.clientX, y: event.clientY };
    depth.current += 1;
    const summary = summarizeDrag(event.dataTransfer);
    setState((previous) =>
      previous.active && previous.summary === summary ? previous : { active: true, summary },
    );
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    depth.current = 0;
    pointer.current = null;
    setState({ active: false, summary: '' });
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      depth.current = 0;
      setState({ active: false, summary: '' });
      pointer.current = { x: event.clientX, y: event.clientY };
      const result = captureTransfer(target, snapshotTransfer(event.dataTransfer), 'drop');
      onResult(
        result.ids.length === 0
          ? {
              ...result,
              message: 'That drop had nothing we could read — try dropping a file or a link.',
            }
          : result,
      );
    },
    [target, onResult],
  );

  return { state, pointer: pointer.current, handlers: { onDragOver, onDragLeave, onDrop } };
}
