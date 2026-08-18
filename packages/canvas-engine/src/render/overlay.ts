/**
 * The DOM overlay: a recycling slot pool plus a mount/update/unmount diff
 * (05_CANVAS_ENGINE.md §6.11, 20_ROADMAP P2 requirements 5 and 15, §7 overlay rules).
 *
 * The document and the container element are handed in by the caller — this module touches no
 * global at import time and is therefore importable (and testable) in Node. It is generic over the
 * element type so a test can pass plain object literals instead of pulling in jsdom; with
 * `E = HTMLElement` the diff is exactly the frozen `OverlayDiff` (see `asOverlayDiff`).
 */

import { MAX_DOM_NODES } from '../constants';
import type { NodeId, NodeKind, NodeView, OverlayDiff, Rect } from '../types';
import { truncateHard } from './text';

/* -------------------------------------------------------------- host types */

export interface OverlaySlotStyle {
  transform: string;
  willChange: string;
  width: string;
  height: string;
}

/** The exact DOM surface the overlay uses. `HTMLElement` satisfies it structurally. */
export interface OverlaySlot {
  style: OverlaySlotStyle;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  remove(): void;
}

export interface OverlayContainer<E extends OverlaySlot> {
  style: OverlaySlotStyle;
  appendChild(child: E): void;
}

export interface OverlayDocument<E extends OverlaySlot> {
  createElement(tagName: 'div'): E;
}

export interface SlotMount<E extends OverlaySlot> {
  id: NodeId;
  domKey: string;
  slot: E;
  rect: Rect;
}
export interface SlotUpdate<E extends OverlaySlot> {
  id: NodeId;
  slot: E;
  rect: Rect;
}
export interface SlotUnmount<E extends OverlaySlot> {
  id: NodeId;
  slot: E;
}

export interface SlotDiff<E extends OverlaySlot> {
  mount: Array<SlotMount<E>>;
  update: Array<SlotUpdate<E>>;
  unmount: Array<SlotUnmount<E>>;
}

/** Compile-time proof that the generic diff is the frozen `OverlayDiff` for real elements. */
export const asOverlayDiff = (diff: SlotDiff<HTMLElement>): OverlayDiff => diff;

export interface OverlayOptions<E extends OverlaySlot> {
  document: OverlayDocument<E>;
  container: OverlayContainer<E>;
  /** Retained slots per node kind (05 §6.11 uses 64). */
  poolLimit?: number;
}

export interface Overlay<E extends OverlaySlot> {
  /**
   * Reconciles the promoted set. `candidates` must already be culled and ordered by importance —
   * the overlay truncates at MAX_DOM_NODES (§6.10).
   *
   * The returned diff object and its three arrays are **reused across frames**: consume them
   * synchronously. This is what keeps a steady-state frame allocation-free (requirement 15).
   */
  sync(candidates: readonly NodeView[]): SlotDiff<E>;
  /** One style write for the whole overlay per camera change (§6.11). */
  setTransform(t: { x: number; y: number; scale: number }): void;
  /** `will-change: transform` costs memory per node, so it is only on during a drag (§7). */
  setDragging(dragging: boolean): void;
  slotOf(id: NodeId): E | undefined;
  readonly mountedCount: number;
  pooled(kind: NodeKind): number;
  dispose(): void;
}

const OFFSCREEN = 'translate3d(-99999px,-99999px,0)';

interface Entry<E extends OverlaySlot> {
  id: NodeId;
  kind: NodeKind;
  domKey: string;
  slot: E;
  rect: Rect;
  version: number;
}

export function createOverlay<E extends OverlaySlot>(options: OverlayOptions<E>): Overlay<E> {
  const poolLimit = options.poolLimit ?? 64;
  const entries = new Map<NodeId, Entry<E>>();
  const pool = new Map<NodeKind, E[]>();
  const seen = new Set<NodeId>();
  const diff: SlotDiff<E> = { mount: [], update: [], unmount: [] };
  let dragging = false;

  const acquire = (kind: NodeKind): E => {
    const free = pool.get(kind);
    const reused = free?.pop();
    if (reused !== undefined) return reused;
    const el = options.document.createElement('div');
    el.style.transform = OFFSCREEN;
    options.container.appendChild(el);
    return el;
  };

  const release = (entry: Entry<E>): void => {
    const el = entry.slot;
    el.style.transform = OFFSCREEN;
    el.style.willChange = '';
    // The slot may host a React card portal (P4 §7); its children belong to the host, so the
    // overlay never clears them — doing so detaches nodes React still owns and its next unmount
    // throws `removeChild: not a child of this node`. Only overlay-owned attributes are reset.
    el.removeAttribute('data-node-id');
    el.removeAttribute('data-title');
    const free = pool.get(entry.kind);
    if (free === undefined) {
      pool.set(entry.kind, [el]);
    } else if (free.length < poolLimit) {
      free.push(el);
    } else {
      el.remove();
    }
  };

  const place = (entry: Entry<E>, node: NodeView): void => {
    const { rect, slot } = entry;
    if (rect.x !== node.x || rect.y !== node.y) {
      rect.x = node.x;
      rect.y = node.y;
      slot.style.transform = `translate3d(${node.x}px,${node.y}px,0)`;
    }
    if (rect.w !== node.w || rect.h !== node.h) {
      rect.w = node.w;
      rect.h = node.h;
      slot.style.width = `${node.w}px`;
      slot.style.height = `${node.h}px`;
    }
  };

  return {
    sync(candidates: readonly NodeView[]): SlotDiff<E> {
      diff.mount.length = 0;
      diff.update.length = 0;
      diff.unmount.length = 0;
      seen.clear();

      const limit = Math.min(candidates.length, MAX_DOM_NODES);
      for (let i = 0; i < limit; i += 1) {
        const node = candidates[i];
        if (node === undefined || node.hidden) continue;
        seen.add(node.id);
        const existing = entries.get(node.id);
        if (existing === undefined) {
          const slot = acquire(node.kind);
          slot.setAttribute('data-node-id', node.id);
          // Security (20_ROADMAP P2 §9): the title is written as a text attribute, never as HTML.
          // CSS renders it (`content: attr(data-title)`) only while the slot has no hosted card.
          slot.setAttribute('data-title', truncateHard(node.glyph.title));
          slot.style.willChange = dragging ? 'transform' : '';
          const entry: Entry<E> = {
            id: node.id,
            kind: node.kind,
            domKey: node.domKey,
            slot,
            rect: { x: NaN, y: NaN, w: NaN, h: NaN },
            version: node.visualVersion,
          };
          place(entry, node);
          entries.set(node.id, entry);
          diff.mount.push({ id: node.id, domKey: node.domKey, slot, rect: entry.rect });
          continue;
        }
        const moved =
          existing.rect.x !== node.x ||
          existing.rect.y !== node.y ||
          existing.rect.w !== node.w ||
          existing.rect.h !== node.h;
        const restyled = existing.version !== node.visualVersion;
        if (moved === false && restyled === false) continue;
        place(existing, node);
        if (restyled) {
          existing.version = node.visualVersion;
          existing.slot.setAttribute('data-title', truncateHard(node.glyph.title));
        }
        diff.update.push({ id: node.id, slot: existing.slot, rect: existing.rect });
      }

      for (const entry of entries.values()) {
        if (seen.has(entry.id)) continue;
        release(entry);
        diff.unmount.push({ id: entry.id, slot: entry.slot });
      }
      for (const gone of diff.unmount) entries.delete(gone.id);
      return diff;
    },
    setTransform(t: { x: number; y: number; scale: number }): void {
      // §4: the identical unrounded camera values the canvas uses, or the rings shimmer.
      options.container.style.transform = `translate3d(${t.x}px,${t.y}px,0) scale(${t.scale})`;
    },
    setDragging(next: boolean): void {
      if (next === dragging) return;
      dragging = next;
      const value = next ? 'transform' : '';
      for (const entry of entries.values()) entry.slot.style.willChange = value;
    },
    slotOf(id: NodeId): E | undefined {
      return entries.get(id)?.slot;
    },
    get mountedCount(): number {
      return entries.size;
    },
    pooled(kind: NodeKind): number {
      return pool.get(kind)?.length ?? 0;
    },
    dispose(): void {
      for (const entry of entries.values()) entry.slot.remove();
      entries.clear();
      for (const free of pool.values()) for (const el of free) el.remove();
      pool.clear();
      diff.mount.length = 0;
      diff.update.length = 0;
      diff.unmount.length = 0;
      seen.clear();
    },
  };
}
