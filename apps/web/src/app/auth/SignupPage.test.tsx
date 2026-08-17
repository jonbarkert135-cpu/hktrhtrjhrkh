import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signUpEmail = vi.fn();
vi.mock('../../lib/auth', () => ({
  API_URL: 'http://localhost:3000',
  authClient: { signUp: { email: (...args: unknown[]): unknown => signUpEmail(...args) } },
  useSession: () => ({ data: null, isPending: false }),
}));

const { default: SignupPage } = await import('./SignupPage');

function renderPage() {
  return render(
    <MemoryRouter>
      <SignupPage />
    </MemoryRouter>,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'analyst@example.com');
  await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('SignupPage', () => {
  beforeEach(() => signUpEmail.mockReset());

  it('shows inline field errors and does not call the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Enter an email address, like you@example.com.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it('confirms without saying whether the address existed', async () => {
    signUpEmail.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Name'), 'Ana');
    await fillAndSubmit(user);
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(signUpEmail).toHaveBeenCalledWith({
      email: 'analyst@example.com',
      password: 'hunter2hunter2',
      name: 'Ana',
    });
  });

  it('gives an already-registered address the same confirmation', async () => {
    signUpEmail.mockResolvedValue({ error: { status: 422 } });
    const user = userEvent.setup();
    renderPage();
    await fillAndSubmit(user);
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
  });

  it('shows a banner when the server cannot be reached', async () => {
    signUpEmail.mockResolvedValue({ error: { status: 500 } });
    const user = userEvent.setup();
    renderPage();
    await fillAndSubmit(user);
    expect(await screen.findByText("Couldn't create your account")).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't reach the server. Check your connection and try again."),
    ).toBeInTheDocument();
  });
});
