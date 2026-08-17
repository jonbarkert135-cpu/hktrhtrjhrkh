import { describe, expect, it } from 'vitest';

import { GUIDE_EXTEND_PX, snapDrag } from '../src/interaction/snapping';
import type { SnapInput } from '../src/interaction/snapping';
import { GRID_SNAP, SNAP_CANDIDATE_LIMIT, SNAP_TOL_PX } from '../src/constants';
import type { NodeView, Rect } from '../src/types';
import { node } from './fsm.support';

const BOX: Rect = { x: 0, y: 0, w: 100, h: 60 };

const input = (over: Partial<SnapInput> = {}): SnapInput => ({
  box: BOX,
  delta: { x: 0, y: 0 },
  candidates: [],
  moving: new Set<string>(),
  zoom: 1,
  gridSnap: false,
  objectSnap: true,
  suspend: false,
  ...over,
});

describe('grid snap', () => {
  it('snaps the dragged box top-left to the 8 px lattice', () => {
    const res = snapDrag(
      input({
        box: { x: 3, y: 5, w: 100, h: 60 },
        delta: { x: 10, y: 10 },
        gridSnap: true,
        objectSnap: false,
      }),
    );
    // 3+10 = 13 → 16 (nearest multiple of 8); 5+10 = 15 → 16.
    expect(res.delta).toEqual({ x: 13, y: 11 });
    expect((3 + res.delta.x) % GRID_SNAP).toBe(0);
    expect(res.guides).toEqual([]);
  });

  it('is off unless the setting is on', () => {
    const res = snapDrag(input({ delta: { x: 3, y: 3 }, gridSnap: false, objectSnap: false }));
    expect(res.delta).toEqual({ x: 3, y: 3 });
  });
});

describe('alignment snap', () => {
  const neighbour = node('n', 300, 0, 100, 60);

  it('captures within SNAP_TOL_PX and draws a guide with hand-computed geometry', () => {
    const res = snapDrag(input({ delta: { x: 0, y: 4 }, candidates: [neighbour] }));
    expect(res.delta).toEqual({ x: 0, y: 0 });
    expect(res.guides).toEqual([
      {
        axis: 'y',
        pos: 0,
        from: 0 - GUIDE_EXTEND_PX,
        to: 400 + GUIDE_EXTEND_PX,
        kind: 'align',
        gap: null,
      },
    ]);
  });

  it('does not capture beyond SNAP_TOL_PX', () => {
    const res = snapDrag(input({ delta: { x: 0, y: SNAP_TOL_PX + 1 }, candidates: [neighbour] }));
    expect(res.delta).toEqual({ x: 0, y: 7 });
    expect(res.guides).toEqual([]);
  });

  it('measures the tolerance in screen px, so zoom changes the world-space reach', () => {
    const zoomedOut = snapDrag(
      input({ delta: { x: 0, y: 10 }, candidates: [neighbour], zoom: 0.5 }),
    );
    expect(zoomedOut.delta.y).toBe(0); // 10 world px = 5 screen px at zoom 0.5
    const zoomedIn = snapDrag(input({ delta: { x: 0, y: 4 }, candidates: [neighbour], zoom: 2 }));
    expect(zoomedIn.delta.y).toBe(4); // 4 world px = 8 screen px at zoom 2
  });

  it('snaps centres, not only edges', () => {
    // A 200-wide neighbour at 250..450 (centre 350); the dragged box's edges are far from its
    // edges, so only the centre line can fire: 298 + 50 = 348, two px short of 350.
    const wide = node('wide', 250, 0, 200, 60);
    const res = snapDrag(input({ delta: { x: 298, y: 0 }, candidates: [wide] }));
    expect(res.delta.x).toBe(300);
    const guide = res.guides.find((g) => g.axis === 'x');
    expect(guide?.pos).toBe(350);
  });

  it('smallest delta per axis wins', () => {
    const near = node('near', 0, 5, 100, 60); // top edge 5 world px away
    const nearer = node('nearer', 0, 2, 100, 60); // top edge 2 world px away
    const res = snapDrag(input({ delta: { x: 0, y: 0 }, candidates: [near, nearer] }));
    expect(res.delta.y).toBe(2);
  });

  it('ties break toward the nearest node', () => {
    const far = node('far', 900, 3, 100, 60);
    const close = node('close', 120, 3, 100, 60);
    const res = snapDrag(input({ delta: { x: 0, y: 0 }, candidates: [far, close] }));
    const [guide] = res.guides;
    expect(res.delta.y).toBe(3);
    // The guide spans the close node's extent, not the far one's.
    expect(guide?.to).toBe(220 + GUIDE_EXTEND_PX);
  });

  it('ignores the nodes being dragged and hidden nodes', () => {
    const self = node('self', 0, 3, 100, 60);
    const ghost = node('ghost', 0, 3, 100, 60, { hidden: true });
    const moving = snapDrag(input({ candidates: [self], moving: new Set(['self']) }));
    expect(moving.delta).toEqual({ x: 0, y: 0 });
    expect(moving.guides).toEqual([]);
    const hidden = snapDrag(input({ candidates: [ghost] }));
    expect(hidden.guides).toEqual([]);
  });

  it('considers only the nearest SNAP_CANDIDATE_LIMIT candidates', () => {
    const filler: NodeView[] = Array.from(
      { length: SNAP_CANDIDATE_LIMIT },
      (_, i) => node(`f${i}`, 200 + i, 500, 40, 40), // far enough on y to never align, close in space
    );
    const aligned = node('aligned', 20000, 3, 100, 60);
    const excluded = snapDrag(input({ candidates: [...filler, aligned] }));
    expect(excluded.delta.y).toBe(0);
    expect(excluded.guides).toEqual([]);

    const included = snapDrag(input({ candidates: [...filler.slice(1), aligned] }));
    expect(included.delta.y).toBe(3);
  });

  it('object snap overrides the grid on the axis where it fires', () => {
    const res = snapDrag(
      input({
        box: { x: 3, y: 0, w: 100, h: 60 },
        delta: { x: 10, y: 4 },
        candidates: [neighbour],
        gridSnap: true,
      }),
    );
    expect(res.delta.y).toBe(0); // alignment beat the lattice
    expect(res.delta.x).toBe(13); // no x guide fired, so the lattice stands
  });

  it('objectSnap off leaves guides empty', () => {
    const res = snapDrag(
      input({ delta: { x: 0, y: 4 }, candidates: [neighbour], objectSnap: false }),
    );
    expect(res.delta).toEqual({ x: 0, y: 4 });
    expect(res.guides).toEqual([]);
  });
});

describe('distribution guides', () => {
  // Two 100-wide boxes with a 100 px gap: 0..100, 200..300. The rhythm continues at x = 400.
  const row = [node('d1', 0, 0, 100, 60), node('d2', 200, 0, 100, 60)];

  it('offers the position that continues an equal-gap rhythm', () => {
    const res = snapDrag(
      input({ box: { x: 0, y: 0, w: 100, h: 60 }, delta: { x: 403, y: 0 }, candidates: row }),
    );
    expect(res.delta.x).toBe(400);
    expect(res.guides.filter((g) => g.axis === 'x')).toEqual([
      {
        axis: 'x',
        pos: 400,
        from: 0 - GUIDE_EXTEND_PX,
        to: 60 + GUIDE_EXTEND_PX,
        kind: 'distribute',
        gap: 100,
      },
    ]);
  });

  it('continues the rhythm on the leading side too', () => {
    const res = snapDrag(input({ delta: { x: -198, y: 0 }, candidates: row }));
    expect(res.delta.x).toBe(-200);
    expect(res.guides.find((g) => g.axis === 'x')?.kind).toBe('distribute');
  });

  it('needs at least two neighbours overlapping the dragged row', () => {
    const offRow = [node('d1', 0, 900, 100, 60), node('d2', 200, 900, 100, 60)];
    const res = snapDrag(input({ delta: { x: 403, y: 0 }, candidates: offRow }));
    expect(res.delta.x).toBe(403);
    expect(res.guides).toEqual([]);
  });

  it('does not fire outside the capture distance or for overlapping neighbours', () => {
    const far = snapDrag(input({ delta: { x: 410, y: 0 }, candidates: row }));
    expect(far.delta.x).toBe(410);
    const overlapping = [node('o1', 0, 0, 100, 60), node('o2', 50, 0, 100, 60)];
    const res = snapDrag(input({ delta: { x: 403, y: 0 }, candidates: overlapping }));
    expect(res.guides.some((g) => g.kind === 'distribute')).toBe(false);
  });

  it('works vertically as well as horizontally', () => {
    const column = [node('c1', 0, 0, 100, 60), node('c2', 0, 160, 100, 60)];
    const res = snapDrag(input({ delta: { x: 0, y: 322 }, candidates: column }));
    expect(res.delta.y).toBe(320);
    expect(res.guides.find((g) => g.axis === 'y')?.kind).toBe('distribute');
  });
});

describe('suspension', () => {
  it('Ctrl/Cmd suspends every snapping system for the frame', () => {
    const res = snapDrag(
      input({
        delta: { x: 3.5, y: 4.25 },
        candidates: [node('n', 300, 0, 100, 60)],
        gridSnap: true,
        suspend: true,
      }),
    );
    expect(res.delta).toEqual({ x: 3.5, y: 4.25 });
    expect(res.guides).toEqual([]);
  });
});
