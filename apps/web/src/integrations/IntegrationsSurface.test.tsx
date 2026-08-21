/**
 * The flow test for the integration surface: pick → consent → run → review → apply → undo, plus
 * the two refusals that matter (no repository at all, and a cancel mid-run).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { WorkspaceProvider } from '../data/workspace/context.tsx';
import type { RunsRepository, WorkspaceRun } from '../data/workspace/runs.ts';
import { fakeWorkspaceRepository } from '../data/workspace/testFakes.ts';
import { IntegrationsSurface } from './IntegrationsSurface.tsx';
import type { IntegrationSummary } from './types.ts';

const tool: IntegrationSummary = {
  id: 'tool-a',
  name: 'URL expander',
  description: 'Follows redirects.',
  executionKind: 'builtin',
  acceptsKinds: [],
  inputs: [{ name: 'url', fromSelection: true, required: true }],
  consent: { required: true, scopeText: 'I am authorized to look this target up.' },
  risk: { label: 'low', reasons: [] },
};

const proposal = {
  id: 'prop-1',
  runId: 'run-1',
  integrationId: 'tool-a',
  boardId: 'b1',
  createdAt: '2025-01-01T00:00:00.000Z',
  summary: { newNodes: 1, newEdges: 0, enriched: 0, conflicts: 0, skippedDuplicates: 0 },
  items: [
    {
      id: 'item-1',
      kind: 'new_node',
      selectedByDefault: true,
      confidence: 0.9,
      explain: 'Final destination of the redirect chain.',
      node: {
        tempId: 't1',
        kind: 'url',
        nodeType: 'url',
        title: 'https://example.com',
        tags: [],
        props: {},
        identityKey: 'url:example.com',
        provenance: {
          source: 'redirect',
          tool: 'tool-a',
          toolVersion: '1.0.0',
          runId: 'run-1',
          observedAt: '2025-01-01T00:00:00.000Z',
          importedAt: '2025-01-01T00:00:00.000Z',
          confidence: 0.9,
          actorUserId: 'u1',
        },
      },
    },
  ],
  issues: [],
  expiresAt: '2035-01-01T00:00:00.000Z',
};

const runRow: WorkspaceRun = {
  id: 'run-1',
  integrationId: 'tool-a',
  boardId: 'b1',
  actorUserId: 'u1',
  status: 'succeeded',
  durationMs: 40,
  proposalId: 'prop-1',
  createdAt: '2025-01-01T00:00:00.000Z',
};

function fakeRuns(over: Partial<RunsRepository> = {}): RunsRepository {
  return {
    kind: 'server',
    acceptConsent: vi.fn().mockResolvedValue({ consentToken: 'c1' }),
    getProposal: vi.fn().mockResolvedValue(proposal),
    listRuns: vi.fn().mockResolvedValue({ runs: [runRow] }),
    startRun: vi.fn().mockResolvedValue({ runId: 'run-1', reused: false, notice: null }),
    cancelRun: vi.fn().mockResolvedValue({ status: 'cancelled', cancelled: true }),
    getRunLog: vi.fn().mockResolvedValue([]),
    ...over,
  };
}

function mount(runs: RunsRepository | undefined, onUndo = vi.fn()) {
  const doc = new Y.Doc();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const repository = { ...fakeWorkspaceRepository(), ...(runs === undefined ? {} : { runs }) };
  const view = render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider repository={repository}>
        <IntegrationsSurface
          open
          onClose={vi.fn()}
          doc={doc}
          boardId="b1"
          projectId="p1"
          selection={[{ id: 'n1', kind: 'url', label: 'https://t.co/x' }]}
          onUndo={onUndo}
          integrations={[tool]}
        />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  return { doc, view };
}

describe('IntegrationsSurface', () => {
  it('renders nothing when the deployment has no run repository (N2)', () => {
    const { view } = mount(undefined);
    expect(view.container).toBeEmptyDOMElement();
  });

  it('runs the whole flow: pick, consent, review, apply, undo', async () => {
    const runs = fakeRuns();
    const onUndo = vi.fn();
    const { doc } = mount(runs, onUndo);

    await userEvent.click(await screen.findByRole('button', { name: /URL expander/ }));
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(runs.startRun).toHaveBeenCalled();
    });
    expect(runs.acceptConsent).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: 'tool-a', projectId: 'p1' }),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Review results' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }));

    expect(doc.getMap('nodes').size).toBe(1);
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalled();
  });

  it('reports a refused start with the taxonomy instead of a blank panel', async () => {
    const runs = fakeRuns({ acceptConsent: vi.fn().mockRejectedValue(new Error('nope')) });
    mount(runs);
    await userEvent.click(await screen.findByRole('button', { name: /URL expander/ }));
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
  });

  it('cancels an active run from the panel', async () => {
    const runs = fakeRuns({
      listRuns: vi.fn().mockResolvedValue({ runs: [{ ...runRow, status: 'running' }] }),
    });
    mount(runs);
    await userEvent.click(await screen.findByRole('button', { name: /URL expander/ }));
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(runs.cancelRun).toHaveBeenCalledWith({ runId: 'run-1' });
    });
  });

  it('re-opens the consent dialog from a history row', async () => {
    mount(fakeRuns());
    await userEvent.click((await screen.findAllByRole('button', { name: 'Re-run' }))[0]!);
    expect(await screen.findByRole('checkbox')).toBeInTheDocument();
  });
});
