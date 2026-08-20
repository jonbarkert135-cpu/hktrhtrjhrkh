/**
 * apps/api/src/boardToken.ts — the seam between the API and `@nexus/domain`'s board-token
 * signer. The server env is read lazily and cached (module state); each test resets the module
 * registry so the cache never leaks between tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadServerEnvFromProcess = vi.fn();

vi.mock('../src/env.ts', () => ({ loadServerEnvFromProcess }));

beforeEach(() => {
  vi.resetModules();
  loadServerEnvFromProcess.mockReset();
});

describe('issueBoardToken', () => {
  it('signs a token that verifies against the configured secret', async () => {
    loadServerEnvFromProcess.mockReturnValue({ SYNC_SHARED_SECRET: 'x'.repeat(32) });
    const { issueBoardToken } = await import('../src/boardToken.ts');
    const { verifyBoardToken } = await import('@nexus/domain');

    const token = issueBoardToken({
      userId: 'u1',
      boardId: 'b1',
      role: 'editor',
      name: 'Ada',
      color: 'hsl(1, 70%, 55%)',
    });

    const result = verifyBoardToken(token, 'x'.repeat(32));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.userId).toBe('u1');
      expect(result.payload.boardId).toBe('b1');
      expect(result.payload.role).toBe('editor');
    }
  });

  it('reads the env only once across multiple calls (secret is cached)', async () => {
    loadServerEnvFromProcess.mockReturnValue({ SYNC_SHARED_SECRET: 'y'.repeat(32) });
    const { issueBoardToken } = await import('../src/boardToken.ts');

    issueBoardToken({ userId: 'u2', boardId: 'b2', role: 'viewer', name: 'Bo', color: 'red' });
    issueBoardToken({ userId: 'u3', boardId: 'b3', role: 'viewer', name: 'Cy', color: 'blue' });

    expect(loadServerEnvFromProcess).toHaveBeenCalledTimes(1);
  });
});
