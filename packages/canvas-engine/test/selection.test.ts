import { describe, expect, it } from 'vitest';

import { createSelection } from '../src/selection';
import type { EntityId, SelectionMode } from '../src/types';
import { node, scene } from './fsm.support';

const nodes = [node('a', 0, 0, 100, 60), node('b', 200, 100, 100, 60), node('c', -50, -20, 40, 40)];
const make = (onChange?: (ids: readonly EntityId[]) => void) =>
  createSelection(scene(nodes), onChange);

describe('selection', () => {
  it('starts empty with no anchor', () => {
    const sel = make();
    expect(sel.ids).toEqual([]);
    expect(sel.anchor).toBeNull();
    expect(sel.bounds()).toBeNull();
    expect(sel.has('a')).toBe(false);
  });

  it('replaces by default, de-duplicating and keeping order', () => {
    const sel = make();
    sel.set(['b', 'a', 'b']);
    expect(sel.ids).toEqual(['b', 'a']);
    sel.set(['c']);
    expect(sel.ids).toEqual(['c']);
  });

  it('anchor is the last selected id', () => {
    const sel = make();
    sel.set(['a', 'b']);
    expect(sel.anchor).toBe('b');
    sel.set(['c'], 'add');
    expect(sel.anchor).toBe('c');
    // Re-adding an existing id re-anchors it.
    sel.set(['a'], 'add');
    expect(sel.ids).toEqual(['b', 'c', 'a']);
    expect(sel.anchor).toBe('a');
  });

  it('toggle adds when absent and removes when present', () => {
    const sel = make();
    sel.set(['a', 'b']);
    sel.set(['b'], 'toggle');
    expect(sel.ids).toEqual(['a']);
    sel.set(['b'], 'toggle');
    expect(sel.ids).toEqual(['a', 'b']);
    sel.set(['a', 'c'], 'toggle');
    expect(sel.ids).toEqual(['b', 'c']);
  });

  it('subtract removes only what is there', () => {
    const sel = make();
    sel.set(['a', 'b', 'c']);
    sel.set(['b', 'zzz'], 'subtract');
    expect(sel.ids).toEqual(['a', 'c']);
  });

  it('selectAll takes every node in the scene, clear empties it', () => {
    const sel = make();
    sel.selectAll();
    expect(sel.ids).toEqual(['a', 'b', 'c']);
    sel.clear();
    expect(sel.ids).toEqual([]);
    expect(sel.anchor).toBeNull();
  });

  it('bounds is the union of the selected nodes and ignores non-node ids', () => {
    const sel = make();
    sel.set(['a']);
    expect(sel.bounds()).toEqual({ x: 0, y: 0, w: 100, h: 60 });
    sel.set(['a', 'b', 'c', 'edge-1']);
    expect(sel.bounds()).toEqual({ x: -50, y: -20, w: 350, h: 180 });
    sel.set(['edge-1']);
    expect(sel.bounds()).toBeNull();
  });

  it('notifies only on real changes', () => {
    const seen: Array<readonly EntityId[]> = [];
    const sel = make((ids) => seen.push([...ids]));
    sel.set(['a']);
    sel.set(['a']); // identical: no notification
    sel.set(['b'], 'add');
    sel.set(['zzz'], 'subtract'); // nothing removed
    sel.clear();
    sel.clear();
    expect(seen).toEqual([['a'], ['a', 'b'], []]);
  });

  it('works without a listener', () => {
    const sel = createSelection(scene(nodes));
    sel.set(['a']);
    expect(sel.has('a')).toBe(true);
  });

  it('stays a de-duplicated ordered set under a random script (seeded)', () => {
    // Tiny mulberry32: deterministic, no new dependency.
    let seed = 0x9e3779b9;
    const rnd = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pool: EntityId[] = ['a', 'b', 'c', 'd', 'e'];
    const modes: SelectionMode[] = ['replace', 'add', 'toggle', 'subtract'];
    const sel = make();
    const mirror = new Set<EntityId>();

    for (let step = 0; step < 500; step += 1) {
      const mode = modes[Math.floor(rnd() * modes.length)] ?? 'replace';
      const ids = pool.filter(() => rnd() < 0.4);
      sel.set(ids, mode);

      if (mode === 'replace') {
        mirror.clear();
        for (const id of ids) mirror.add(id);
      } else if (mode === 'subtract') {
        for (const id of ids) mirror.delete(id);
      } else if (mode === 'add') {
        for (const id of ids) mirror.add(id);
      } else {
        for (const id of ids) {
          if (mirror.has(id)) mirror.delete(id);
          else mirror.add(id);
        }
      }

      expect(new Set(sel.ids)).toEqual(mirror);
      expect(sel.ids).toHaveLength(new Set(sel.ids).size);
      expect(sel.anchor).toBe(sel.ids.length === 0 ? null : sel.ids[sel.ids.length - 1]);
      for (const id of sel.ids) expect(sel.has(id)).toBe(true);
    }
  });
});
