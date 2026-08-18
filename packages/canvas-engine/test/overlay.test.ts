import { describe, expect, it } from 'vitest';

import { MAX_DOM_NODES } from '../src/constants';
import type { OverlayContainer, OverlayDocument, OverlaySlot } from '../src/render/overlay';
import { createOverlay } from '../src/render/overlay';
import { makeNode } from './render-fixtures';

/**
 * Minimal element stubs — the package's vitest environment is node-only and stays that way
 * (18_TESTING.md §5, acceptance criterion 8).
 */
interface FakeSlot extends OverlaySlot {
  attrs: Map<string, string>;
  removed: boolean;
}

function fakeSlot(): FakeSlot {
  return {
    style: { transform: '', willChange: '', width: '', height: '' },
    attrs: new Map<string, string>(),
    removed: false,
    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
    },
    removeAttribute(name: string): void {
      this.attrs.delete(name);
    },
    remove(): void {
      this.removed = true;
    },
  };
}

function fakeDom(): {
  document: OverlayDocument<FakeSlot>;
  container: OverlayContainer<FakeSlot>;
  children: FakeSlot[];
  created: number;
} {
  const children: FakeSlot[] = [];
  const state = { created: 0 };
  return {
    document: {
      createElement: (): FakeSlot => {
        state.created += 1;
        return fakeSlot();
      },
    },
    container: {
      style: { transform: '', willChange: '', width: '', height: '' },
      appendChild: (child: FakeSlot): void => {
        children.push(child);
      },
    },
    children,
    get created(): number {
      return state.created;
    },
  };
}

describe('overlay diff', () => {
  it('mounts, updates and unmounts exactly the nodes that changed', () => {
    const dom = fakeDom();
    const overlay = createOverlay<FakeSlot>(dom);
    const a = makeNode(0);
    const b = makeNode(1);

    const first = overlay.sync([a, b]);
    expect(first.mount.map((m) => m.id)).toEqual([a.id, b.id]);
    expect(first.update).toHaveLength(0);
    expect(overlay.mountedCount).toBe(2);
    expect(dom.children).toHaveLength(2);
    expect(overlay.slotOf(a.id)?.attrs.get('data-node-id')).toBe(a.id);

    const unchanged = overlay.sync([a, b]);
    expect(unchanged.mount).toHaveLength(0);
    expect(unchanged.update).toHaveLength(0);
    expect(unchanged.unmount).toHaveLength(0);

    const moved = { ...a, x: a.x + 40 };
    const third = overlay.sync([moved, b]);
    expect(third.update.map((u) => u.id)).toEqual([a.id]);
    expect(overlay.slotOf(a.id)?.style.transform).toBe(`translate3d(${moved.x}px,${a.y}px,0)`);

    const fourth = overlay.sync([b]);
    expect(fourth.unmount.map((u) => u.id)).toEqual([a.id]);
    expect(overlay.mountedCount).toBe(1);
  });

  it('re-renders a slot when only visualVersion changed', () => {
    const overlay = createOverlay<FakeSlot>(fakeDom());
    const a = makeNode(0);
    overlay.sync([a]);
    const restyled = { ...a, visualVersion: 2, glyph: { ...a.glyph, title: 'Renamed' } };
    const diff = overlay.sync([restyled]);
    expect(diff.update.map((u) => u.id)).toEqual([a.id]);
    expect(overlay.slotOf(a.id)?.attrs.get('data-title')).toBe('Renamed');
  });

  it('writes titles as a text attribute only and hard-truncates them (P2 §9)', () => {
    const overlay = createOverlay<FakeSlot>(fakeDom());
    const node = makeNode(0, { glyph: { ...makeNode(0).glyph, title: 'y'.repeat(5000) } });
    overlay.sync([node]);
    expect(overlay.slotOf(node.id)?.attrs.get('data-title')).toHaveLength(256);
  });

  it('skips hidden nodes and honours the MAX_DOM_NODES budget (§6.10)', () => {
    const overlay = createOverlay<FakeSlot>(fakeDom());
    const nodes = Array.from({ length: MAX_DOM_NODES + 40 }, (_, i) => makeNode(i));
    nodes[0] = makeNode(0, { hidden: true });
    overlay.sync(nodes);
    expect(overlay.mountedCount).toBe(MAX_DOM_NODES - 1);
  });

  it('reuses the same diff arrays across frames (no steady-state allocation, req 15)', () => {
    const overlay = createOverlay<FakeSlot>(fakeDom());
    const nodes = [makeNode(0), makeNode(1)];
    const first = overlay.sync(nodes);
    // The arrays are reused, so anything read from a previous frame must be captured now.
    const rect = first.mount[0]?.rect;
    const second = overlay.sync(nodes);
    const third = overlay.sync(nodes);
    expect(second).toBe(first);
    expect(second.mount).toBe(first.mount);
    expect(second.update).toBe(first.update);
    expect(second.unmount).toBe(first.unmount);
    expect(third.mount).toHaveLength(0);

    // The per-node rect object is stable too: the host may hold on to it across frames.
    expect(rect).toBeDefined();
    const shifted = nodes.map((n, i) => (i === 0 ? { ...n, x: n.x + 1 } : n));
    expect(overlay.sync(shifted).update[0]?.rect).toBe(rect);
  });
});

describe('slot pool', () => {
  it('hands the very same element back after an unmount (§6.11)', () => {
    const dom = fakeDom();
    const overlay = createOverlay<FakeSlot>(dom);
    const a = makeNode(0, { kind: 'note' });
    overlay.sync([a]);
    const slot = overlay.slotOf(a.id);
    expect(slot).toBeDefined();

    overlay.sync([]);
    expect(overlay.pooled('note')).toBe(1);
    expect(slot?.style.transform).toBe('translate3d(-99999px,-99999px,0)');
    expect(slot?.attrs.has('data-node-id')).toBe(false);
    expect(slot?.attrs.has('data-title')).toBe(false);

    const b = makeNode(2, { kind: 'note' });
    overlay.sync([b]);
    expect(overlay.slotOf(b.id)).toBe(slot);
    expect(dom.created).toBe(1);
    expect(overlay.pooled('note')).toBe(0);
  });

  it('keys the pool by node kind', () => {
    const dom = fakeDom();
    const overlay = createOverlay<FakeSlot>(dom);
    const note = makeNode(0, { kind: 'note' });
    const site = makeNode(1, { kind: 'website' });
    overlay.sync([note, site]);
    overlay.sync([]);
    expect(overlay.pooled('note')).toBe(1);
    expect(overlay.pooled('website')).toBe(1);
    expect(overlay.pooled('image')).toBe(0);
    expect(dom.created).toBe(2);
  });

  it('drops slots beyond the pool limit instead of leaking them', () => {
    const dom = fakeDom();
    const overlay = createOverlay<FakeSlot>({ ...dom, poolLimit: 2 });
    const nodes = Array.from({ length: 5 }, (_, i) => makeNode(i, { kind: 'note' }));
    overlay.sync(nodes);
    const slots = nodes.map((n) => overlay.slotOf(n.id));
    overlay.sync([]);
    expect(overlay.pooled('note')).toBe(2);
    expect(slots.filter((s) => s?.removed === true)).toHaveLength(3);
  });
});

describe('overlay transform and lifecycle', () => {
  it('positions the container with the unrounded camera values (§4)', () => {
    const dom = fakeDom();
    const overlay = createOverlay<FakeSlot>(dom);
    overlay.setTransform({ x: -12.75, y: 30.5, scale: 0.625 });
    expect(dom.container.style.transform).toBe('translate3d(-12.75px,30.5px,0) scale(0.625)');
  });

  it('sets will-change only while dragging (P2 §7)', () => {
    const overlay = createOverlay<FakeSlot>(fakeDom());
    const a = makeNode(0);
    overlay.sync([a]);
    expect(overlay.slotOf(a.id)?.style.willChange).toBe('');

    overlay.setDragging(true);
    expect(overlay.slotOf(a.id)?.style.willChange).toBe('transform');
    const b = makeNode(1);
    overlay.sync([a, b]);
    expect(overlay.slotOf(b.id)?.style.willChange).toBe('transform');

    overlay.setDragging(true); // idempotent
    overlay.setDragging(false);
    expect(overlay.slotOf(a.id)?.style.willChange).toBe('');
  });

  it('writes a size only when the node was resized', () => {
    const overlay = createOverlay<FakeSlot>(fakeDom());
    const a = makeNode(0);
    overlay.sync([a]);
    expect(overlay.slotOf(a.id)?.style.width).toBe(`${a.w}px`);
    const resized = { ...a, w: 400 };
    overlay.sync([resized]);
    expect(overlay.slotOf(a.id)?.style.width).toBe('400px');
  });

  it('dispose() removes every mounted and pooled element (criterion 7)', () => {
    const dom = fakeDom();
    const overlay = createOverlay<FakeSlot>(dom);
    const nodes = [makeNode(0), makeNode(1), makeNode(2)];
    overlay.sync(nodes);
    overlay.sync(nodes.slice(0, 1));
    overlay.dispose();

    expect(overlay.mountedCount).toBe(0);
    expect(overlay.pooled('note')).toBe(0);
    expect(overlay.pooled('website')).toBe(0);
    expect(dom.children.every((c) => c.removed)).toBe(true);
    expect(overlay.slotOf(nodes[0]?.id ?? '')).toBeUndefined();
  });
});
