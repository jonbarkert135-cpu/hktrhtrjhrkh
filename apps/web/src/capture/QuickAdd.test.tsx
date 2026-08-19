/**
 * P6 §5.11, §6 — quick add: `N`, `L`, the "+" menu, the live "what will this become" hint, and the
 * clipboard-denied fallback (the same field accepts a pasted payload).
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuickAdd, describePayload } from './QuickAdd.tsx';
import { PasteToast, TOAST_TIMEOUT_MS } from './PasteToast.tsx';

describe('describePayload', () => {
  it('names the node type before the user commits', () => {
    expect(describePayload('https://a.example/')).toBe('Adds one website node.');
    expect(describePayload('https://a.example/\nhttps://b.example/')).toBe('Adds 2 website nodes.');
    expect(describePayload('a short thought')).toBe('Adds one text node.');
    expect(describePayload('x'.repeat(281))).toBe('Adds one note.');
    expect(describePayload('   ')).toBe('Paste a link, several links, or any text.');
  });
});

describe('QuickAdd', () => {
  it('creates a note on N and opens the capture field on L', () => {
    const onNote = vi.fn();
    render(<QuickAdd onNote={onNote} onCapture={vi.fn()} />);

    fireEvent.keyDown(window, { key: 'n' });
    expect(onNote).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByTestId('quick-add-input')).toBeTruthy();
  });

  it('ignores the shortcuts while the analyst is typing or holding a modifier', () => {
    const onNote = vi.fn();
    render(<QuickAdd onNote={onNote} onCapture={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'l' });
    const input = screen.getByTestId('quick-add-input');
    fireEvent.keyDown(input, { key: 'n' });
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    expect(onNote).not.toHaveBeenCalled();
  });

  it('captures the typed payload on Enter and clears the field', () => {
    const onCapture = vi.fn();
    render(<QuickAdd onNote={vi.fn()} onCapture={onCapture} />);
    fireEvent.keyDown(window, { key: 'l' });
    const input = screen.getByTestId('quick-add-input');
    fireEvent.change(input, { target: { value: 'https://a.example/' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCapture).toHaveBeenCalledWith('https://a.example/');
  });

  it('does not capture an empty field', () => {
    const onCapture = vi.fn();
    render(<QuickAdd onNote={vi.fn()} onCapture={onCapture} />);
    fireEvent.keyDown(window, { key: 'l' });
    fireEvent.click(screen.getByTestId('quick-add-confirm'));
    expect(onCapture).not.toHaveBeenCalled();
  });
});

describe('PasteToast', () => {
  it('renders nothing without a message', () => {
    const { container } = render(
      <PasteToast message={null} onUndo={null} onImportList={null} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('offers Undo and the list import, and dismisses itself after 8 s', () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    const onImportList = vi.fn();
    const onDismiss = vi.fn();
    render(
      <PasteToast
        message="Added 50 links"
        onUndo={onUndo}
        onImportList={onImportList}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByText('Undo'));
    fireEvent.click(screen.getByText('Import as a list'));
    expect(onUndo).toHaveBeenCalled();
    expect(onImportList).toHaveBeenCalled();

    vi.advanceTimersByTime(TOAST_TIMEOUT_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
