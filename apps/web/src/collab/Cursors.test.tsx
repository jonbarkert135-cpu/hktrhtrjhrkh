import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Cursors } from './Cursors';
import type { AwarenessState } from '@nexus/domain';

function cursorState(overrides: Partial<AwarenessState> = {}): AwarenessState {
  return {
    userId: 'u1',
    tabId: 't1',
    name: 'Alex',
    color: '#fff',
    cursor: { x: 10, y: 20 },
    selection: [],
    viewport: null,
    activeNodeId: null,
    ...overrides,
  };
}

describe('Cursors', () => {
  it('renders a cursor with its label when not faded', () => {
    render(<Cursors cursors={[{ state: cursorState(), faded: false }]} toScreen={(p) => p} />);
    expect(screen.getByTestId('cursor-u1')).toBeInTheDocument();
    expect(screen.getByTestId('cursor-label-u1')).toHaveTextContent('Alex');
  });

  it('hides the label once faded (P8 §6)', () => {
    render(<Cursors cursors={[{ state: cursorState(), faded: true }]} toScreen={(p) => p} />);
    expect(screen.queryByTestId('cursor-label-u1')).not.toBeInTheDocument();
  });

  it('skips a client with no cursor position', () => {
    render(
      <Cursors
        cursors={[{ state: cursorState({ cursor: null }), faded: false }]}
        toScreen={(p) => p}
      />,
    );
    expect(screen.queryByTestId('cursor-u1')).not.toBeInTheDocument();
  });
});
