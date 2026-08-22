import { makeEdge, makeNode } from '@nexus/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PresentationMode } from './PresentationMode.tsx';
import { buildDeck } from './deck.ts';

const NOW = '2026-08-17T12:00:00.000Z';
const NODES = [
  makeNode({ id: 'n1', x: 0, y: 0, title: 'Hub' }, NOW),
  makeNode({ id: 'n2', x: 0, y: 0, title: 'Leaf' }, NOW),
];
const EDGES = [makeEdge({ id: 'e1', from: 'n1', to: 'n2' }, NOW)];

describe('buildDeck', () => {
  it('appends a conclusion slide after the selected steps', () => {
    const deck = buildDeck(NODES, EDGES, { selectedIds: ['n1', 'n2'], conclusion: 'Same owner.' });
    expect(deck.map((slide) => slide.kind)).toEqual(['step', 'step', 'conclusion']);
    expect(deck[0]?.title).toBe('Step 1 — Hub');
    expect(deck[2]?.body).toBe('Same owner.');
  });

  it('falls back to starred nodes and ignores unknown ids', () => {
    const starred = [{ ...NODES[0]!, starred: true }, NODES[1]!];
    expect(buildDeck(starred, EDGES, { selectedIds: [] })).toHaveLength(2);
    expect(buildDeck(NODES, EDGES, { selectedIds: ['ghost'] })).toEqual([]);
  });
});

describe('PresentationMode', () => {
  it('walks the deck with the keyboard and closes on Escape', () => {
    const onClose = vi.fn();
    const onFocus = vi.fn();
    render(
      <PresentationMode
        open
        nodes={NODES}
        edges={EDGES}
        selectedIds={['n1', 'n2']}
        onClose={onClose}
        onFocus={onFocus}
      />,
    );
    expect(screen.getByText('1 / 3')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 3')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('1 / 3')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(onFocus).toHaveBeenCalledWith(['n1']);
  });

  it('advances with the Next button and stops at the conclusion', () => {
    render(
      <PresentationMode
        open
        nodes={NODES}
        edges={EDGES}
        selectedIds={['n1']}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('presentation-next'));
    expect(screen.getByText('Conclusion')).toBeTruthy();
    expect(screen.getByTestId('presentation-next').hasAttribute('disabled')).toBe(true);
  });

  it('explains what to do when nothing is selected', () => {
    render(
      <PresentationMode
        open
        nodes={NODES}
        edges={EDGES}
        selectedIds={[]}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId('presentation-empty')).toBeTruthy();
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <PresentationMode
        open={false}
        nodes={NODES}
        edges={EDGES}
        selectedIds={['n1']}
        onClose={() => undefined}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
