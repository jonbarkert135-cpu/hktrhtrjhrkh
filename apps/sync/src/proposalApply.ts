/**
 * Server-side proposal apply (10_INTEGRATIONS.md §10, `POST /v1/proposals/:id/apply`).
 *
 * Headless callers (API tokens, webhooks) cannot run the client-side Applier, but they must not get
 * a *second* write path either — that is how two implementations of "one undo step" drift apart. So
 * the same `applyProposal` from `packages/integrations` runs here, against the board's snapshot,
 * inside the same single transaction; the resulting update is stored and picked up by every
 * connected client through Hocuspocus.
 */

import * as Y from 'yjs';
import { newId } from '@nexus/domain';
import { applyProposal, type ApplyResult, type ImportProposal } from '@nexus/integrations';

import type { SnapshotStore } from './persistence.ts';

export interface ApplyProposalRequest {
  readonly boardId: string;
  readonly proposal: ImportProposal;
  readonly selectedItemIds: readonly string[];
  readonly conflictResolutions: Readonly<Record<string, 'keep' | 'replace' | 'keep_both'>>;
  readonly alreadyApplied?: Readonly<Record<string, string>>;
  readonly now: string;
}

export interface ApplyProposalOutcome {
  readonly result: ApplyResult;
  /** The Yjs update produced by the apply; stored and broadcast, never re-derived. */
  readonly update: Uint8Array;
}

/**
 * Applies a proposal to the stored board document. The caller (the HTTP route) owns
 * authentication; this function owns correctness.
 */
export async function applyProposalToBoard(
  store: SnapshotStore,
  request: ApplyProposalRequest,
): Promise<ApplyProposalOutcome> {
  const snapshot = await store.latest(request.boardId);
  if (snapshot === null) {
    throw new Error(`board ${request.boardId} has no stored document to apply to`);
  }

  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot.binary);
  const before = Y.encodeStateVector(doc);

  const result = applyProposal(doc, request.proposal, {
    selectedItemIds: request.selectedItemIds,
    conflictResolutions: request.conflictResolutions,
    placement: 'radial',
    newId: () => newId.board(),
    now: request.now,
    ...(request.alreadyApplied === undefined ? {} : { alreadyApplied: request.alreadyApplied }),
  });

  const update = Y.encodeStateAsUpdate(doc, before);
  await store.write(request.boardId, {
    binary: Y.encodeStateAsUpdate(doc),
    stateVector: Y.encodeStateVector(doc),
    seq: snapshot.seq + 1,
  });

  return { result, update };
}
