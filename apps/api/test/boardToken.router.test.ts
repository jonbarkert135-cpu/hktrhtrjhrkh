import { describe, expect, it, vi } from 'vitest';
import { ORG_ID, ctx, prismaMock } from './prisma-mock.ts';
import type { IssueBoardTokenInput } from '../src/boardToken.ts';

vi.mock('@nexus/db', () => ({ prisma: prismaMock }));

const issueBoardToken = vi.fn((_input: IssueBoardTokenInput) => 'signed.token');
vi.mock('../src/boardToken.ts', () => ({ issueBoardToken }));

const { appRouter } = await import('../src/trpc/router.ts');
const { createCallerFactory } = await import('../src/trpc/trpc.ts');

const caller = createCallerFactory(appRouter);

const BOARD_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

describe('boardToken.issue', () => {
  it('issues a token for a board that exists in the caller org', async () => {
    prismaMock.board.findFirst.mockResolvedValue({ id: BOARD_ID });

    const result = await caller(ctx({ role: 'editor' })).boardToken.issue({ boardId: BOARD_ID });

    expect(prismaMock.board.findFirst).toHaveBeenCalledWith({
      where: { id: BOARD_ID, orgId: ORG_ID, deletedAt: null },
      select: { id: true },
    });
    expect(issueBoardToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        boardId: BOARD_ID,
        role: 'editor',
        name: 'A',
      }),
    );
    const call = issueBoardToken.mock.calls[0]?.[0];
    expect(call?.color).toMatch(/^hsl\(\d+, 70%, 55%\)$/);
    expect(result).toEqual({ token: 'signed.token', expiresInMs: 5 * 60 * 1000 });
  });

  it('derives a stable, deterministic color for the same user id', async () => {
    prismaMock.board.findFirst.mockResolvedValue({ id: BOARD_ID });
    await caller(ctx({ role: 'editor' })).boardToken.issue({ boardId: BOARD_ID });
    await caller(ctx({ role: 'editor' })).boardToken.issue({ boardId: BOARD_ID });
    const colors = issueBoardToken.mock.calls.map((c) => c[0].color);
    expect(colors[0]).toBe(colors[1]);
  });

  it('throws NOT_FOUND for a board in another org', async () => {
    prismaMock.board.findFirst.mockResolvedValue(null);
    await expect(
      caller(ctx({ role: 'editor' })).boardToken.issue({ boardId: BOARD_ID }),
    ).rejects.toThrow(/no longer exists/i);
    expect(issueBoardToken).not.toHaveBeenCalled();
  });

  it('rejects a malformed board id', async () => {
    await expect(
      caller(ctx({ role: 'editor' })).boardToken.issue({ boardId: 'nope' }),
    ).rejects.toThrow(/not a valid id/i);
  });

  it('allows a viewer to issue a token (read-only role still needs to connect)', async () => {
    prismaMock.board.findFirst.mockResolvedValue({ id: BOARD_ID });
    const result = await caller(ctx({ role: 'viewer' })).boardToken.issue({ boardId: BOARD_ID });
    expect(result.token).toBe('signed.token');
    expect(issueBoardToken).toHaveBeenCalledWith(expect.objectContaining({ role: 'viewer' }));
  });
});
