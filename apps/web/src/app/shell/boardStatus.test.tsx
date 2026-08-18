import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { BoardStatusProvider, useBoardStatus } from './boardStatus';

function Probe({ counts }: { counts: { nodes: number; edges: number } | null }) {
  const status = useBoardStatus();
  return (
    <div>
      <output data-testid="counts">
        {status.counts === null
          ? 'none'
          : `${String(status.counts.nodes)}/${String(status.counts.edges)}`}
      </output>
      <output data-testid="persistence">{status.persistence}</output>
      <button onClick={() => status.publish({ counts })}>publish counts</button>
      <button onClick={() => status.publish({ persistence: 'Saving…' })}>
        publish persistence
      </button>
    </div>
  );
}

describe('board status channel', () => {
  it('starts with no board and the local persistence label', () => {
    render(
      <BoardStatusProvider>
        <Probe counts={null} />
      </BoardStatusProvider>,
    );
    expect(screen.getByTestId('counts')).toHaveTextContent('none');
    expect(screen.getByTestId('persistence')).toHaveTextContent('Saved locally');
  });

  it('publishes counts and persistence independently', async () => {
    const user = userEvent.setup();
    render(
      <BoardStatusProvider>
        <Probe counts={{ nodes: 4, edges: 2 }} />
      </BoardStatusProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'publish counts' }));
    expect(screen.getByTestId('counts')).toHaveTextContent('4/2');

    await user.click(screen.getByRole('button', { name: 'publish persistence' }));
    expect(screen.getByTestId('persistence')).toHaveTextContent('Saving…');
    // Publishing one field must not drop the other.
    expect(screen.getByTestId('counts')).toHaveTextContent('4/2');
  });

  it('ignores a republish of identical counts', async () => {
    const user = userEvent.setup();
    render(
      <BoardStatusProvider>
        <Probe counts={{ nodes: 1, edges: 0 }} />
      </BoardStatusProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'publish counts' }));
    await user.click(screen.getByRole('button', { name: 'publish counts' }));
    expect(screen.getByTestId('counts')).toHaveTextContent('1/0');
  });

  it('falls back to an inert channel when no provider is mounted', () => {
    render(<Probe counts={{ nodes: 9, edges: 9 }} />);
    expect(screen.getByTestId('counts')).toHaveTextContent('none');
    expect(screen.getByTestId('persistence')).toHaveTextContent('Saved locally');
  });
});
