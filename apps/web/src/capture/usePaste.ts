/**
 * Paste is the front door (03_UX.md §3, P6 §5.1–§5.4). The hook is deliberately thin: it snapshots
 * the `DataTransfer`, hands it to the pure detector in `@nexus/domain`, and writes the resulting
 * plan in one transaction — so paste, drop and quick-add cannot drift apart.
 *
 * Nothing here waits on the network: the nodes appear immediately (a website node in its `pending`
 * state), which is also what makes an offline paste work (N2).
 */

import {
  createNodesFromPlan,
  parseClip,
  pasteSubgraph,
  detectTransfer,
  occupiedBoxes,
  planCapture,
  type CaptureOrigin,
  type CapturePlan,
  type ClipSource,
  type TransferSnapshot,
} from '@nexus/domain';
import { useCallback, useEffect } from 'react';
import type * as Y from 'yjs';

export interface CaptureTarget {
  doc: Y.Doc;
  /** Undo label + separator, so one paste is one undo step. */
  history?: { label(text: string): void; separate(): void } | undefined;
  /** World point to aim at: the pointer over the canvas, else the viewport centre. */
  aim: () => { x: number; y: number };
  now?: (() => string) | undefined;
  /** The board being pasted into; a clip from elsewhere keeps a reference to its origin (§20). */
  into?: ClipSource | undefined;
}

export interface CaptureResult {
  ids: string[];
  message: string | null;
  /** Set when a >50 URL paste was capped: the toast offers "Import as a list". */
  overflow: CapturePlan['overflow'];
  /** Replaying the same payload as one list node is the answer to that offer. */
  snapshot: TransferSnapshot;
}

/** Reads everything the detector may look at out of a live `DataTransfer`. */
export function snapshotTransfer(data: DataTransfer | null): TransferSnapshot {
  if (data === null) return {};
  const files = Array.from(data.files ?? []).map((file) => ({
    name: file.name,
    type: file.type,
    size: file.size,
  }));
  const read = (type: string): string | undefined => {
    try {
      const value = data.getData(type);
      return value === '' ? undefined : value;
    } catch {
      return undefined;
    }
  };
  return {
    files: files.length > 0 ? files : undefined,
    html: read('text/html'),
    uriList: read('text/uri-list'),
    text: read('text/plain'),
  };
}

/** Detect → plan → one transaction. Returns what the toast needs to say. */
export function captureTransfer(
  target: CaptureTarget,
  snapshot: TransferSnapshot,
  origin: CaptureOrigin,
  options: { asList?: boolean } = {},
): CaptureResult {
  // An internal clip (§18) short-circuits the detector: it is our own JSON, not outside content.
  const clip = snapshot.text === undefined ? null : parseClip(snapshot.text);
  if (clip !== null && clip.nodes.length > 0) {
    const now = (target.now ?? (() => new Date().toISOString()))();
    target.history?.label('paste selection');
    const { nodeIds } = pasteSubgraph(target.doc, clip, {
      at: target.aim(),
      now,
      into: target.into,
    });
    target.history?.separate();
    const count = nodeIds.length;
    return {
      ids: nodeIds,
      message: `Pasted ${String(count)} node${count === 1 ? '' : 's'}`,
      overflow: null,
      snapshot,
    };
  }

  const detection = detectTransfer(snapshot);
  const plan = planCapture(detection, {
    at: target.aim(),
    origin,
    occupied: occupiedBoxes(target.doc),
    asList: options.asList ?? false,
  });
  if (plan.items.length === 0) {
    return { ids: [], message: null, overflow: null, snapshot };
  }
  target.history?.label(plan.message ?? 'capture');
  const now = (target.now ?? (() => new Date().toISOString()))();
  const ids = createNodesFromPlan(target.doc, plan, { now, origin });
  target.history?.separate();
  return { ids, message: plan.message, overflow: plan.overflow, snapshot };
}

/** Window-level `paste` handler. Ignores pastes aimed at a text field — those belong to the field. */
export function usePaste(target: CaptureTarget, onResult: (result: CaptureResult) => void): void {
  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      if (isEditable(event.target)) return;
      const snapshot = snapshotTransfer(event.clipboardData);
      const result = captureTransfer(target, snapshot, 'paste');
      event.preventDefault();
      onResult(
        result.ids.length === 0
          ? { ...result, message: 'Nothing to paste — the clipboard is empty.' }
          : result,
      );
    },
    [target, onResult],
  );

  useEffect(() => {
    const handler = onPaste as EventListener;
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [onPaste]);
}

function isEditable(node: EventTarget | null): boolean {
  if (node === null || !(node instanceof HTMLElement)) return false;
  return node.isContentEditable || node.tagName === 'INPUT' || node.tagName === 'TEXTAREA';
}
