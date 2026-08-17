import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.fn();
vi.mock('../lib/auth', () => ({
  API_URL: 'http://localhost:3000',
  authClient: { signIn: { email: vi.fn() }, signOut: vi.fn() },
  useSession: (): unknown => session(),
}));

// The shell fetches the project rail; the guard tests care about routing, not about data.
vi.mock('../lib/trpc', () => ({
  errorMessage: () => 'The server took too long to answer.',
  trpc: {
    useUtils: () => ({ project: { list: { invalidate: vi.fn() } } }),
    project: {
      list: {
        useQuery: (): unknown => ({ isPending: false, error: null, data: [], refetch: vi.fn() }),
      },
      create: { useMutation: (): unknown => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
  },
}));

const { AppRoutes } = await import('./router');

function go(url: string) {
  window.history.pushState({}, '', url);
}

beforeEach(() => {
  session.mockReset();
  // BoardPage draws on a canvas jsdom cannot provide.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('AppRoutes auth guard', () => {
  it('sends an unauthenticated visitor to /login with a next param', async () => {
    session.mockReturnValue({ data: null, isPending: false });
    go('/settings');
    render(<AppRoutes />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toBe('?next=%2Fsettings');
  });

  it('shows the shell skeleton while the session resolves', () => {
    session.mockReturnValue({ data: null, isPending: true });
    go('/');
    render(<AppRoutes />);
    expect(screen.getByLabelText('Loading board')).toBeInTheDocument();
  });

  it('lets an authenticated user reach the board', async () => {
    session.mockReturnValue({ data: { user: { name: 'Ana' } }, isPending: false });
    go('/');
    render(<AppRoutes />);
    expect(await screen.findByTestId('canvas-surface')).toBeInTheDocument();
  });

  it('bounces an authenticated user off /login to the next param', async () => {
    session.mockReturnValue({ data: { user: { name: 'Ana' } }, isPending: false });
    go('/login?next=%2Fsettings');
    render(<AppRoutes />);
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/settings');
  });

  it('redirects an unknown path to the board', async () => {
    session.mockReturnValue({ data: { user: { name: 'Ana' } }, isPending: false });
    go('/nope');
    render(<AppRoutes />);
    expect(await screen.findByTestId('canvas-surface')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});
