/** The connection band around a card (20_ROADMAP P5 §5.3). */

import { describe, expect, it } from 'vitest';

import { facingPort, portAt, portPoint } from '../../src/edges/ports';
import { PORT_BAND_PX } from '../../src/constants';
import { node } from '../fsm.support';

const card = node('a', 0, 0, 100, 60);

describe('portAt', () => {
  it('picks the nearest side and the offset along it', () => {
    expect(portAt(card, { x: 50, y: 1 }, 1)).toEqual({ side: 'top', t: 0.5 });
    expect(portAt(card, { x: 99, y: 30 }, 1)).toEqual({ side: 'right', t: 0.5 });
    expect(portAt(card, { x: 25, y: 59 }, 1)).toEqual({ side: 'bottom', t: 0.25 });
    expect(portAt(card, { x: 1, y: 15 }, 1)).toEqual({ side: 'left', t: 0.25 });
  });

  it('straddles the border: a few px outside still grabs the port', () => {
    expect(portAt(card, { x: 100 + PORT_BAND_PX - 1, y: 30 }, 1)).toMatchObject({ side: 'right' });
    expect(portAt(card, { x: 100 + PORT_BAND_PX + 1, y: 30 }, 1)).toBeNull();
  });

  it('is empty in the middle of the card, so dragging a card still drags it', () => {
    expect(portAt(card, { x: 50, y: 30 }, 1)).toBeNull();
  });

  it('keeps a constant screen size: zooming out widens the world band', () => {
    expect(portAt(card, { x: 112, y: 30 }, 0.25)).toMatchObject({ side: 'right' });
    expect(portAt(card, { x: 112, y: 30 }, 1)).toBeNull();
  });

  it('never lets the band swallow more than a quarter of the card', () => {
    // At zoom 0.05 the unclamped band would be 200 world px — wider than the whole card.
    expect(portAt(card, { x: 50, y: 30 }, 0.05)).toBeNull();
    expect(portAt(card, { x: 50, y: 2 }, 0.05)).toMatchObject({ side: 'top' });
  });

  it('ignores locked and hidden cards', () => {
    expect(portAt(node('l', 0, 0, 100, 60, { locked: true }), { x: 99, y: 30 }, 1)).toBeNull();
    expect(portAt(node('h', 0, 0, 100, 60, { hidden: true }), { x: 99, y: 30 }, 1)).toBeNull();
  });
});

describe('portPoint and facingPort', () => {
  it('places a resolved anchor on the border and auto in the centre', () => {
    expect(portPoint(card, { side: 'right', t: 0.5 })).toEqual({ x: 100, y: 30 });
    expect(portPoint(card, { side: 'top', t: 0 })).toEqual({ x: 0, y: 0 });
    expect(portPoint(card, { side: 'auto', t: 0.5 })).toEqual({ x: 50, y: 30 });
  });

  it('turns a free pointer into the side of the card that faces it', () => {
    expect(facingPort(card, { x: 400, y: 30 }).side).toBe('right');
    expect(facingPort(card, { x: -400, y: 30 }).side).toBe('left');
    expect(facingPort(card, { x: 50, y: -400 }).side).toBe('top');
    expect(facingPort(card, { x: 50, y: 400 }).side).toBe('bottom');
  });
});
