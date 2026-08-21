/**
 * The zero-backend acceptance test (ADR-001).
 *
 * It is the one test that must never be weakened: the app boots, routes and lets the user work
 * while every outbound transport is sabotaged. `fetch`, `XMLHttpRequest` and `WebSocket` all throw
 * on use, so any component that quietly reaches for the API fails this suite loudly instead of
 * degrading into a spinner on the user's machine.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from './providers';
import { AppRoutes } from './router';

const forbid = (what: string) => () => {
  throw new Error(`Local mode must not use ${what}.`);
};

beforeEach(() => {
  vi.stubGlobal('fetch', forbid('fetch'));
  vi.stubGlobal('XMLHttpRequest', forbid('XMLHttpRequest'));
  vi.stubGlobal('WebSocket', forbid('WebSocket'));
  // The canvas draws through a 2D context jsdom does not implement.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const app = () => (
  <AppProviders>
    <AppRoutes />
  </AppProviders>
);

describe('local mode, no backend of any kind', () => {
  it('opens straight onto a working board — no account, no login redirect', async () => {
    render(app());
    expect(
      await screen.findByTestId('canvas-surface', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('has no /login route at all: the path falls through to the board', async () => {
    window.history.pushState({}, '', '/login');
    render(app());
    expect(
      await screen.findByTestId('canvas-surface', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('offers no sign-out, because there is no account to sign out of', async () => {
    render(app());
    await screen.findByTestId('canvas-surface', {}, { timeout: 10_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('has no integration surface at all: tools are server-side, so they are absent (P9, N2)', async () => {
    render(app());
    await screen.findByTestId('canvas-surface', {}, { timeout: 10_000 });
    expect(screen.queryByTestId('integrations-surface')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run integration…' })).not.toBeInTheDocument();
    // The local repository's run methods exist only to fail loudly if anything calls them.
    const { localRuns } = await import('../data/workspace/runs.ts');
    expect(() => localRuns().listRuns()).toThrow(/Raven server/);
  });

  it('creates a project on the device and lists it in the rail', async () => {
    render(app());
    await screen.findByTestId('canvas-surface', {}, { timeout: 10_000 });
    await userEvent.click(
      await screen.findByRole('button', { name: /create your first project|new project/i }),
    );
    await userEvent.type(await screen.findByLabelText(/name/i), 'Kompromat');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(
      () => {
        expect(screen.getByRole('link', { name: 'Kompromat' })).toBeInTheDocument();
      },
      { timeout: 10_000 },
    );
  });
});
