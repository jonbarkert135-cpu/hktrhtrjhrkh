/**
 * §13 point 2 and §11 of the phase spec: the parse queue over happy, truncated and malformed
 * fixtures, plus the paths that must never end in a run without an explanation.
 */

import { describe, expect, it } from 'vitest';
import type {
  ArtifactRef,
  ExistingNodeMatch,
  ImportProposal,
  IntegrationErrorPayload,
} from '@nexus/integrations';

import { processParseJob, type ParseStore, type RunRow } from '../src/queues/integration.parse.ts';

const NOW = '2026-02-01T00:00:00.000Z';

const artifact: ArtifactRef = {
  bucket: 'raven',
  key: 'runs/org-1/run-1/result.json',
  bytes: 128,
  sha256: '0'.repeat(64),
  contentType: 'application/json',
  truncated: false,
};

const run: RunRow = {
  id: 'run-1',
  orgId: 'org-1',
  projectId: 'project-1',
  boardId: 'board-1',
  integrationId: 'expand-url',
  actorUserId: 'user-1',
  anchorNodeId: 'node-anchor',
  input: { url: 'https://sho.rt/x' },
  artifacts: [artifact],
  status: 'parsing',
  exitCode: 0,
  startedAt: new Date(NOW),
  finishedAt: new Date(NOW),
  durationMs: 900,
  stats: { bytesOut: 128, egressRequests: 1, egressDenied: 0, peakMemMiB: 8 },
};

const HAPPY = JSON.stringify({
  version: '1.0',
  inputUrl: 'https://sho.rt/x',
  finalUrl: 'https://example.test/landing',
  hops: 1,
  status: 200,
  chain: ['https://sho.rt/x', 'https://example.test/landing'],
  observedAt: NOW,
});

const TRUNCATED = HAPPY.slice(0, 40);

function harness(
  content: string,
  options: { candidates?: readonly ExistingNodeMatch[]; row?: RunRow | null } = {},
) {
  const saved: ImportProposal[] = [];
  const failures: IntegrationErrorPayload[] = [];
  const logs: { level: string; phase: string; message: string }[] = [];
  let succeeded: { proposalId: string; itemsFound: number } | undefined;

  const store: ParseStore = {
    loadRun: () => Promise.resolve(options.row === undefined ? run : options.row),
    findCandidates: () => Promise.resolve(options.candidates ?? []),
    saveProposal: (proposal) => {
      saved.push(proposal);
      return Promise.resolve();
    },
    markSucceeded: (_runId, proposalId, itemsFound) => {
      succeeded = { proposalId, itemsFound };
      return Promise.resolve();
    },
    markFailed: (_runId, payload) => {
      failures.push(payload);
      return Promise.resolve();
    },
    appendLog: (_runId, entries) => {
      logs.push(...entries);
      return Promise.resolve();
    },
  };

  const deps = {
    store,
    artifacts: {
      read: () =>
        Promise.resolve(
          (async function* stream() {
            yield new TextEncoder().encode(content);
          })(),
        ),
    },
    newProposalId: () => 'proposal-1',
    now: () => NOW,
  };

  return {
    deps,
    saved,
    failures,
    logs,
    get succeeded() {
      return succeeded;
    },
  };
}

describe('integration.parse (stages 3–7)', () => {
  it('turns a happy artifact into a stored proposal and a succeeded run', async () => {
    const h = harness(HAPPY);
    const outcome = await processParseJob(h.deps, 'run-1');

    expect(outcome.status).toBe('succeeded');
    expect(outcome.proposalId).toBe('proposal-1');
    expect(h.saved[0]?.summary.newNodes).toBe(1);
    expect(h.saved[0]?.items.every((item) => item.explain.length > 0)).toBe(true);
    expect(h.succeeded?.itemsFound).toBeGreaterThan(0);
    expect(h.logs.some((line) => line.phase === 'propose')).toBe(true);
  });

  it('attaches provenance with the run id and the artifact to every proposed node (R7)', async () => {
    const h = harness(HAPPY);
    await processParseJob(h.deps, 'run-1');
    const item = h.saved[0]?.items.find((candidate) => candidate.kind === 'new_node');
    expect(item?.kind).toBe('new_node');
    if (item?.kind === 'new_node') {
      expect(item.node.provenance.runId).toBe('run-1');
      expect(item.node.provenance.tool).toBe('expand-url');
      expect(item.node.provenance.artifactRef?.key).toBe(artifact.key);
      expect(item.node.provenance.actorUserId).toBe('user-1');
    }
  });

  it('enriches instead of duplicating when the identity already exists on the board', async () => {
    const h = harness(HAPPY, {
      candidates: [
        {
          nodeId: 'node-1',
          kind: 'url',
          identityKey: 'url:https://example.test/landing',
          title: 'Landing',
          props: {},
          boardId: 'board-1',
        },
      ],
    });
    await processParseJob(h.deps, 'run-1');
    expect(h.saved[0]?.summary.newNodes).toBe(0);
    expect(h.saved[0]?.summary.enriched).toBe(1);
  });

  it('fails a malformed artifact with PARSE_UNSUPPORTED_SHAPE and logs why', async () => {
    const h = harness('this is not json');
    const outcome = await processParseJob(h.deps, 'run-1');
    expect(outcome.status).toBe('failed');
    expect(h.failures[0]?.code).toBe('PARSE_UNSUPPORTED_SHAPE');
    expect(h.logs.some((line) => line.message.includes('PARSE_UNSUPPORTED_SHAPE'))).toBe(true);
  });

  it('fails a truncated artifact rather than importing half a record', async () => {
    const h = harness(TRUNCATED);
    const outcome = await processParseJob(h.deps, 'run-1');
    expect(outcome.status).toBe('failed');
    expect(h.failures[0]?.code).toBe('PARSE_UNSUPPORTED_SHAPE');
  });

  it('produces an empty proposal, not an error, when the URL is already canonical', async () => {
    const h = harness(
      JSON.stringify({
        version: '1.0',
        inputUrl: 'https://example.test/',
        finalUrl: 'https://example.test/',
        hops: 0,
        status: 200,
        chain: [],
        observedAt: NOW,
      }),
    );
    const outcome = await processParseJob(h.deps, 'run-1');
    expect(outcome.status).toBe('succeeded');
    expect(h.saved[0]?.summary.newNodes).toBe(0);
    expect(h.succeeded?.itemsFound).toBe(0);
  });

  it('honours the parse timeout instead of hanging the queue (§6.7)', async () => {
    const h = harness(HAPPY);
    const outcome = await processParseJob(
      {
        ...h.deps,
        artifacts: { read: () => new Promise(() => undefined) },
        timeoutMs: 10,
      },
      'run-1',
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.error?.code).toBe('PARSE_TIMEOUT');
  });

  it('throws for a run id that does not exist', async () => {
    const h = harness(HAPPY, { row: null });
    await expect(processParseJob(h.deps, 'missing')).rejects.toThrow(/does not exist/);
  });
});
