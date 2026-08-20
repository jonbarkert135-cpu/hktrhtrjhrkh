/**
 * Deleting a project or board has no undo step (P7 §14): the dialog requires retyping the exact
 * name before it calls `onConfirm`, resets itself each time it reopens, and surfaces server
 * errors as a banner.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

describe('ConfirmDeleteDialog', () => {
  it('blocks the delete and shows a field error when the typed name does not match', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={vi.fn()}
        kind="project"
        name="Alpha"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText('Type "Alpha" to confirm'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Type "Alpha" exactly to confirm.')).toBeInTheDocument();
  });

  it('confirms once the exact name is retyped', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={vi.fn()}
        kind="board"
        name="Investigation board"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText('Type "Investigation board" to confirm'), {
      target: { value: 'Investigation board' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('resets the typed value and any field error each time it reopens', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDeleteDialog
        open
        onOpenChange={vi.fn()}
        kind="project"
        name="Alpha"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.change(screen.getByLabelText('Type "Alpha" to confirm'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Type "Alpha" exactly to confirm.')).toBeInTheDocument();

    rerender(
      <ConfirmDeleteDialog
        open={false}
        onOpenChange={vi.fn()}
        kind="project"
        name="Alpha"
        onConfirm={onConfirm}
      />,
    );
    rerender(
      <ConfirmDeleteDialog
        open
        onOpenChange={vi.fn()}
        kind="project"
        name="Alpha"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByText('Type "Alpha" exactly to confirm.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Type "Alpha" to confirm')).toHaveValue('');
  });

  it('shows a banner with the server error and cancels without deleting', () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={onOpenChange}
        kind="project"
        name="Alpha"
        error="Network error, try again"
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("Couldn't delete this project")).toBeInTheDocument();
    expect(screen.getByText('Network error, try again')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables cancel and delete while submitting', () => {
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={vi.fn()}
        kind="project"
        name="Alpha"
        submitting
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});
