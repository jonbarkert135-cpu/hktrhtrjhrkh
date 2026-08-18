import { describe, expect, it } from 'vitest';

import { findFreePlacement } from './placement.ts';

const SIZE = { w: 100, h: 60 };

describe('findFreePlacement', () => {
  it('keeps the aim when the board is empty', () => {
    expect(findFreePlacement({ desired: { x: 10, y: 20 }, size: SIZE, occupied: [] })).toEqual({
      x: 10,
      y: 20,
    });
  });

  it('moves off an occupied slot instead of stacking', () => {
    const occupied = [{ x: 0, y: 0, ...SIZE }];
    const spot = findFreePlacement({ desired: { x: 0, y: 0 }, size: SIZE, occupied });
    expect(spot).not.toEqual({ x: 0, y: 0 });
    const overlapping =
      spot.x < occupied[0]!.x + SIZE.w && occupied[0]!.x < spot.x + SIZE.w && spot.y < SIZE.h;
    expect(overlapping).toBe(false);
  });

  it('never returns a slot that touches an existing node, gap included', () => {
    const gap = 24;
    const occupied = Array.from({ length: 9 }, (_, index) => ({
      x: (index % 3) * (SIZE.w + gap) - (SIZE.w + gap),
      y: Math.floor(index / 3) * (SIZE.h + gap) - (SIZE.h + gap),
      ...SIZE,
    }));
    const spot = findFreePlacement({ desired: { x: 0, y: 0 }, size: SIZE, occupied, gap });
    for (const box of occupied) {
      const hits =
        spot.x < box.x + box.w + gap &&
        box.x < spot.x + SIZE.w + gap &&
        spot.y < box.y + box.h + gap &&
        box.y < spot.y + SIZE.h + gap;
      expect(hits).toBe(false);
    }
  });

  it('is deterministic for the same board and aim', () => {
    const occupied = [
      { x: 0, y: 0, ...SIZE },
      { x: 124, y: 0, ...SIZE },
    ];
    const first = findFreePlacement({ desired: { x: 0, y: 0 }, size: SIZE, occupied });
    const second = findFreePlacement({ desired: { x: 0, y: 0 }, size: SIZE, occupied });
    expect(first).toEqual(second);
  });

  it('still returns a spot when every ring is taken', () => {
    const gap = 24;
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        occupied.push({ x: dx * (SIZE.w + gap), y: dy * (SIZE.h + gap), ...SIZE });
      }
    }
    const spot = findFreePlacement({
      desired: { x: 0, y: 0 },
      size: SIZE,
      occupied,
      gap,
      maxRings: 2,
    });
    expect(Number.isFinite(spot.x)).toBe(true);
    expect(Number.isFinite(spot.y)).toBe(true);
  });
});
