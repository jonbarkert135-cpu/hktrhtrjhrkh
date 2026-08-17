import { describe, expect, it, vi } from 'vitest';

// better-auth's React client touches window storage on construction; the module under test only
// owns the base URL resolution, so the client factory is stubbed.
vi.mock('better-auth/react', () => ({
  createAuthClient: (options: { baseURL: string }) => ({
    baseURL: options.baseURL,
    useSession: () => null,
  }),
}));

describe('API_URL', () => {
  it('defaults to the canonical API port (3001, 19_DEPLOYMENT.md §7)', async () => {
    const { API_URL, authClient } = await import('./auth');
    expect(API_URL).toBe('http://localhost:3001');
    expect((authClient as unknown as { baseURL: string }).baseURL).toBe(API_URL);
  });
});
