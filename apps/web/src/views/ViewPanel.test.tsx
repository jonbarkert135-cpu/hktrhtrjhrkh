import { makeEdge, makeNode } from '@nexus/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ViewPanel } from './ViewPanel.tsx';

const NOW = '2026-08-17T12:00:00.000Z';
const NODES = [
  makeNode({ id: 'n1', x: 0, y: 0, title: 'Hub' }, NOW),
  makeNode({ id: 'n2', x: 0, y: 0, title: 'Leaf', data: { lat: 10, lon: 20 } }, NOW),
];
const EDGES = [makeEdge({ id: 'e1', from: 'n1', to: 'n2', label: 'owns' }, NOW)];

describe('ViewPanel', () => {
  it('renders every mode from the same data', () => {
    for (const mode of ['table', 'list', 'timeline', 'map', 'graph'] as const) {
      const { unmount } = render(<ViewPanel mode={mode} nodes={NODES} edges={EDGES} />);
      expect(screen.getByTestId(`view-${mode}`)).toBeTruthy();
      unmount();
    }
  });

  it('selects a node from the table', () => {
    const onSelect = vi.fn();
    render(<ViewPanel mode="table" nodes={NODES} edges={EDGES} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Hub'));
    expect(onSelect).toHaveBeenCalledWith('n1');
  });

  it('selects a node from the list and the timeline', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <ViewPanel mode="list" nodes={NODES} edges={EDGES} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('Hub'));
    unmount();
    render(<ViewPanel mode="timeline" nodes={NODES} edges={EDGES} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByText('Leaf')[0]!);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('reports how many nodes could not be placed on the map', () => {
    render(<ViewPanel mode="map" nodes={NODES} edges={EDGES} />);
    expect(screen.getByText('1 placed · 1 without coordinates')).toBeTruthy();
  });
});
