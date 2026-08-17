import { describe, expect, it, vi } from 'vitest';

// better-auth's React client touches window storage on construction; the module under test only
// owns the base URL resolution, so the client factory is stubbed.
vi.mock('better-auth/react', () => ({
  createAuthClient: (options: { baseURL: string; basePath?: string }) => ({
    baseURL: options.baseURL,
    basePath: options.basePath,
    useSession: () => null,
  }),
}));

describe('API_URL', () => {
  it('defaults to the canonical API port (3001, 19_DEPLOYMENT.md §7)', async () => {
    const { API_URL, authClient } = await import('./auth');
    expect(API_URL).toBe('http://localhost:3001');
    expect((authClient as unknown as { baseURL: string }).baseURL).toBe(API_URL);
  });

  // Regression guard: the client's default base path is /api/auth, the API serves /auth.
  // A mismatch makes every sign-up/sign-in request 404 (CI run 32071533040, e2e J01).
  it('points at the API auth mount point (/auth), not the client default', async () => {
    const { AUTH_BASE_PATH, authClient } = await import('./auth');
    expect(AUTH_BASE_PATH).toBe('/auth');
    expect((authClient as unknown as { basePath: string }).basePath).toBe('/auth');
  });
});
