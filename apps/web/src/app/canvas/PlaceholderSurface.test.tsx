import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaceholderSurface } from './PlaceholderSurface';

// jsdom has no 2D context and no rAF loop worth running: fake both so the effect runs one frame.
let frameCallback: FrameRequestCallback | null = null;
const cancelFrame = vi.fn();
const setCapture = vi.fn();
const releaseCapture = vi.fn();

function pointer(type: string, x: number, y: number): PointerEvent {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  return event as PointerEvent;
}

beforeEach(() => {
  frameCallback = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    canvas: { width: 64, height: 64 },
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  HTMLCanvasElement.prototype.setPointerCapture = setCapture;
  HTMLCanvasElement.prototype.releasePointerCapture = releaseCapture;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameCallback = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
});

afterEach(() => {
  delete window.__nexusBench;
});

describe('PlaceholderSurface', () => {
  it('renders a labelled canvas and publishes bench metrics after a frame', () => {
    render(<PlaceholderSurface />);
    expect(screen.getByTestId('placeholder-surface')).toBeInTheDocument();
    expect(screen.getByRole('application')).toHaveAttribute(
      'aria-roledescription',
      'Research canvas',
    );
    expect(window.__nexusBench).toBeUndefined();

    act(() => frameCallback?.(performance.now() + 20));
    expect(window.__nexusBench?.frames).toBe(1);
  });

  it('pans on pointer drag and stops after pointer up', () => {
    render(<PlaceholderSurface />);
    const canvas = screen.getByTestId('placeholder-surface');
    canvas.dispatchEvent(pointer('pointerdown', 10, 10));
    canvas.dispatchEvent(pointer('pointermove', 30, 40));
    canvas.dispatchEvent(pointer('pointerup', 30, 40));
    canvas.dispatchEvent(pointer('pointermove', 90, 90));
    expect(setCapture).toHaveBeenCalled();
    expect(releaseCapture).toHaveBeenCalled();
  });

  it('cancels the loop and removes the bench hook on unmount', () => {
    const view = render(<PlaceholderSurface />);
    act(() => frameCallback?.(performance.now() + 20));
    expect(window.__nexusBench).toBeDefined();
    view.unmount();
    expect(cancelFrame).toHaveBeenCalled();
    expect(window.__nexusBench).toBeUndefined();
  });
});
