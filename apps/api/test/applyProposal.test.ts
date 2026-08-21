/** The API's forward-to-sync apply seam (10_INTEGRATIONS.md §10): the API never writes a board. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadServerEnvFromProcess = vi.fn();
vi.mock('../src/env.ts', () => ({
  loadServerEnvFromProcess: () => loadServerEnvFromProcess() as unknown,
}));

const { applyProposalRemotely, setApplyTransport } = await import(
  '../src/integrations/applyProposal.ts'
);

const input = {
  boardId: 'b1',
  proposal: { id: 'p1' } as never,
  selectedItemIds: ['i1'],
  conflictResolutions: { i1: 'replace' as const },
  now: '2026-02-01T00:00:00.000Z',
};

const response = (over: Partial<Response> = {}): Response =>
  ({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ applied: 1 }),
    text: () => Promise.resolve(''),
    ...over,
  }) as Response;

beforeEach(() => {
  loadServerEnvFromProcess.mockReturnValue({
    SYNC_URL: 'http://sync:3002/',
    SYNC_SHARED_SECRET: 'shhh',
  });
});

describe('applyProposalRemotely', () => {
  it('posts the whole input to sync with the shared secret and a normalised URL', async () => {
    const transport = vi.fn().mockResolvedValue(response());
    setApplyTransport(transport);

    await expect(applyProposalRemotely(input)).resolves.toEqual({ applied: 1 });

    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://sync:3002/internal/proposals/apply');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer shhh',
    });
    expect(JSON.parse(String(init.body))).toMatchObject({ boardId: 'b1', selectedItemIds: ['i1'] });
  });

  it('turns a refusal into an error carrying the status and a truncated detail', async () => {
    setApplyTransport(() =>
      Promise.resolve(
        response({ ok: false, status: 409, text: () => Promise.resolve('x'.repeat(500)) }),
      ),
    );

    await expect(applyProposalRemotely(input)).rejects.toThrow(/sync refused the apply \(409\)/);
    await expect(applyProposalRemotely(input)).rejects.toThrow(/x{200}$/);
  });
});
