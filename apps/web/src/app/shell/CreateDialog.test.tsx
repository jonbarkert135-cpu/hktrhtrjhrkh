import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreateDialog } from './CreateDialog';

function open(props: Partial<Parameters<typeof CreateDialog>[0]> = {}) {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <CreateDialog
      open
      onOpenChange={onOpenChange}
      title="New project"
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit, onOpenChange };
}

describe('CreateDialog', () => {
  it('submits the trimmed name', () => {
    const { onSubmit } = open();
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: '  Atlas  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(onSubmit).toHaveBeenCalledWith('Atlas');
  });

  it('refuses an empty name and says what to do', () => {
    const { onSubmit } = open();
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/enter a name/i);
  });

  it('cancels without submitting', () => {
    const { onOpenChange, onSubmit } = open();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the server error and blocks a second submit while pending', () => {
    const { onSubmit } = open({ submitting: true, error: 'The server took too long to answer.' });
    expect(screen.getByText('The server took too long to answer.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders the optional description', () => {
    open({ description: 'Boards live here.' });
    expect(screen.getByText('Boards live here.')).toBeInTheDocument();
  });
});
