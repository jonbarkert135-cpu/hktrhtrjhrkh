/** The run seam: local refuses loudly (N2), server passes straight through. */

import { describe, expect, it, vi } from 'vitest';

import { createServerRuns, localRuns, type RunsApi } from './runs.ts';

const api = (): RunsApi => ({
  acceptConsent: vi.fn().mockResolvedValue({ consentToken: 'c1' }),
  getProposal: vi.fn().mockResolvedValue({ id: 'p1' }),
  listRuns: vi.fn().mockResolvedValue({ runs: [] }),
  startRun: vi.fn().mockResolvedValue({ runId: 'r1', reused: false, notice: null }),
  cancelRun: vi.fn().mockResolvedValue({ status: 'cancelled', cancelled: true }),
  getRunLog: vi.fn().mockResolvedValue([]),
});

describe('localRuns', () => {
  it('throws on every method rather than pretending to work', () => {
    const repository = localRuns();
    expect(repository.kind).toBe('local');
    expect(() => repository.listRuns()).toThrow(/Raven server/);
    expect(() => repository.startRun({} as never)).toThrow(/Raven server/);
    expect(() => repository.cancelRun({ runId: 'r1' })).toThrow(/Raven server/);
    expect(() => repository.getRunLog({ runId: 'r1' })).toThrow(/Raven server/);
    expect(() => repository.getProposal({ proposalId: 'p1' })).toThrow(/Raven server/);
    expect(() => repository.acceptConsent({} as never)).toThrow(/Raven server/);
  });
});

describe('createServerRuns', () => {
  it('forwards every call to the API, defaulting the list options', async () => {
    const client = api();
    const repository = createServerRuns(client);
    expect(repository.kind).toBe('server');
    await repository.listRuns();
    expect(client.listRuns).toHaveBeenCalledWith({});
    await repository.acceptConsent({
      projectId: 'p1',
      integrationId: 'tool-a',
      scope: 'public-index',
      targets: [],
      scopeText: 'x',
    });
    await repository.getProposal({ proposalId: 'p1' });
    await repository.startRun({
      integrationId: 'tool-a',
      projectId: 'p1',
      boardId: 'b1',
      input: {},
      targets: [],
      consentToken: 'c1',
    });
    await repository.cancelRun({ runId: 'r1' });
    await repository.getRunLog({ runId: 'r1' });
    for (const fn of Object.values(client)) expect(fn).toHaveBeenCalled();
  });
});
