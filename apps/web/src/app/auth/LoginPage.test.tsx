import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signInEmail = vi.fn();
vi.mock('../../lib/auth', () => ({
  API_URL: 'http://localhost:3000',
  authClient: { signIn: { email: (...args: unknown[]): unknown => signInEmail(...args) } },
  useSession: () => ({ data: null, isPending: false }),
}));

const { default: LoginPage } = await import('./LoginPage');

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => signInEmail.mockReset());

  it('shows inline field errors and does not call the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter an email address, like you@example.com.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('shows a specific form error when the credentials are rejected', async () => {
    signInEmail.mockResolvedValue({ error: { status: 401 } });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Email'), 'analyst@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText("Couldn't sign you in")).toBeInTheDocument();
  });

  it('disables the form while submitting', async () => {
    // held open on purpose: the assertion is about the in-flight state, released at the end so
    // no pending promise survives the test
    let release = (): void => {};
    signInEmail.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ error: null });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Email'), 'analyst@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    release();
  });
});
