/**
 * Ghost preview rendering: nothing without a diff, one from/to pair per move, capped at
 * `MAX_GHOSTS`, and the world transform follows the camera imperatively (P14a; N1).
 */

import type { Engine } from '@nexus/canvas-engine';
import type { LayoutDiff, LayoutMove } from '@nexus/layout';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LayoutGhosts, MAX_GHOSTS } from './LayoutGhosts.tsx';

function move(i: number): LayoutMove {
  return { id: `n${String(i)}`, fromX: i, fromY: i, x: i * 10, y: i * 5, w: 200, h: 120 };
}

function diff(count: number): LayoutDiff {
  return {
    algorithm: 'cluster',
    seed: 1,
    moves: Array.from({ length: count }, (_, i) => move(i)),
    stats: {
      moved: count,
      unchanged: 0,
      pinned: 0,
      bounds: { x: 0, y: 0, w: 100, h: 100 },
      overlaps: 0,
    },
  };
}

/** Minimal engine stub: a camera plus the one event the component subscribes to. */
function fakeEngine(): { engine: Engine; emit: () => void; unsubscribed: () => boolean } {
  const listeners = new Set<() => void>();
  let off = false;
  const engine = {
    camera: { state: { x: 5, y: 7, zoom: 2 } },
    on: (event: string, fn: () => void) => {
      expect(event).toBe('cameraChanged');
      listeners.add(fn);
      return () => {
        off = true;
        listeners.delete(fn);
      };
    },
  } as unknown as Engine;
  return {
    engine,
    emit: () => {
      for (const fn of listeners) fn();
    },
    unsubscribed: () => off,
  };
}

afterEach(cleanup);

describe('LayoutGhosts', () => {
  it('renders nothing without a diff or with an empty one', () => {
    const { rerender } = render(<LayoutGhosts engine={null} diff={null} />);
    expect(screen.queryByTestId('layout-ghosts')).toBeNull();
    rerender(<LayoutGhosts engine={null} diff={diff(0)} />);
    expect(screen.queryByTestId('layout-ghosts')).toBeNull();
  });

  it('draws a target ghost per move and caps the count', () => {
    render(<LayoutGhosts engine={null} diff={diff(3)} />);
    expect(screen.getAllByTestId('layout-ghost-target')).toHaveLength(3);
    cleanup();

    render(<LayoutGhosts engine={null} diff={diff(MAX_GHOSTS + 5)} />);
    expect(screen.getAllByTestId('layout-ghost-target')).toHaveLength(MAX_GHOSTS);
  });

  it('follows the camera without re-rendering, and unsubscribes on unmount', () => {
    const { engine, emit, unsubscribed } = fakeEngine();
    const { unmount } = render(<LayoutGhosts engine={engine} diff={diff(2)} />);

    const world = screen.getByTestId('layout-ghosts').firstElementChild as HTMLElement;
    expect(world.style.transform).toBe('scale(2) translate(-5px, -7px)');

    (engine.camera.state as { x: number }).x = 40;
    emit();
    expect(world.style.transform).toBe('scale(2) translate(-40px, -7px)');

    unmount();
    expect(unsubscribed()).toBe(true);
  });
});
