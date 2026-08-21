import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createBoardDoc } from '@nexus/domain';
import type { ImportProposal } from '@nexus/integrations';

import { applyProposalToBoard } from '../src/proposalApply.ts';
import type { SnapshotRecord, SnapshotStore } from '../src/persistence.ts';

const NOW = '2026-02-01T00:00:00.000Z';

function memoryStore(initial: Uint8Array | null): SnapshotStore & { written: SnapshotRecord[] } {
  const written: SnapshotRecord[] = [];
  return {
    written,
    latest: () =>
      Promise.resolve(
        initial === null ? null : { binary: initial, stateVector: new Uint8Array(), seq: 1 },
      ),
    write: (_boardId, record) => {
      written.push(record);
      return Promise.resolve();
    },
  };
}

const proposal = (): ImportProposal => ({
  id: 'proposal-1',
  runId: 'run-1',
  integrationId: 'expand-url',
  boardId: 'board-1',
  createdAt: NOW,
  summary: { newNodes: 1, newEdges: 0, enriched: 0, conflicts: 0, skippedDuplicates: 0 },
  issues: [],
  expiresAt: '2030-01-01T00:00:00.000Z',
  items: [
    {
      id: 'n:1',
      kind: 'new_node',
      selectedByDefault: true,
      confidence: 0.9,
      explain: 'expand-url observed this destination.',
      node: {
        tempId: 'n:1',
        identityKey: 'url:https://example.test/landing',
        nodeType: 'link',
        title: 'https://example.test/landing',
        props: { url: 'https://example.test/landing' },
        tags: ['link-expand'],
        provenance: {
          source: 'Expand URL 1.0.0',
          tool: 'expand-url',
          toolVersion: '1.0.0',
          runId: 'run-1',
          observedAt: NOW,
          importedAt: NOW,
          confidence: 0.9,
          actorUserId: 'user-1',
        },
      },
    },
  ],
});

describe('headless proposal apply (§10)', () => {
  it('applies through the same Applier and stores the new snapshot', async () => {
    const doc = createBoardDoc({ boardId: 'board-1', title: 'test', now: NOW });
    const store = memoryStore(Y.encodeStateAsUpdate(doc));

    const outcome = await applyProposalToBoard(store, {
      boardId: 'board-1',
      proposal: proposal(),
      selectedItemIds: ['n:1'],
      conflictResolutions: {},
      now: NOW,
    });

    expect(outcome.result.createdNodeIds).toHaveLength(1);
    expect(store.written[0]?.seq).toBe(2);

    const replayed = new Y.Doc();
    Y.applyUpdate(replayed, store.written[0]?.binary ?? new Uint8Array());
    expect(replayed.getMap('nodes').size).toBe(1);
  });

  it('refuses a board that has never been stored rather than inventing one', async () => {
    await expect(
      applyProposalToBoard(memoryStore(null), {
        boardId: 'board-1',
        proposal: proposal(),
        selectedItemIds: ['n:1'],
        conflictResolutions: {},
        now: NOW,
      }),
    ).rejects.toThrow(/no stored document/);
  });
});
