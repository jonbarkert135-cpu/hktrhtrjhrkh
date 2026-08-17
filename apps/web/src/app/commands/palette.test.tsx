import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CommandPalette } from './palette';

describe('CommandPalette', () => {
  it('opens on Cmd/Ctrl+K', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    expect(screen.queryByText('No commands yet')).not.toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByText('No commands yet')).toBeInTheDocument();
  });

  it('is ignored while typing in a text input', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="note" />
        <CommandPalette />
      </>,
    );
    await user.click(screen.getByLabelText('note'));
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByText('No commands yet')).not.toBeInTheDocument();
  });
});
