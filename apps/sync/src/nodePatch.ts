/**
 * Server-side node `data` patch (11_GITHUB.md §3.5 item 3, §4.3).
 *
 * Hydration and tab caches are *field patches on a node the user already created*, not proposals
 * (N4 still holds: nothing new is created here). The worker cannot write the Y.Doc itself, and the
 * projection is read-only for application code, so — exactly like the headless proposal apply next
 * door — the write goes through this one module against the board's snapshot.
 */

import * as Y from 'yjs';
import { getNode, updateNode } from '@nexus/domain';

import type { SnapshotStore } from './persistence.ts';

export interface PatchNodeRequest {
  readonly boardId: string;
  readonly nodeId: string;
  /** Shallow-merged into the node's `data`; a `null` value clears one key. */
  readonly data: Readonly<Record<string, unknown>>;
  readonly now: string;
}

export interface PatchNodeOutcome {
  /** `false` when the node is gone — a deleted node is not an error, the job just stops (N8). */
  readonly patched: boolean;
}

export async function patchNodeData(
  store: SnapshotStore,
  request: PatchNodeRequest,
): Promise<PatchNodeOutcome> {
  const snapshot = await store.latest(request.boardId);
  if (snapshot === null) {
    throw new Error(`board ${request.boardId} has no stored document to patch`);
  }

  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot.binary);
  const node = getNode(doc, request.nodeId);
  if (node === undefined) return { patched: false };

  updateNode(
    doc,
    request.nodeId,
    { data: { ...node.data, ...request.data } },
    // Enrichment, not a user action: this must never land in anyone's undo stack (08 §2.4).
    { origin: 'remote:enrich', now: request.now },
  );

  await store.write(request.boardId, {
    binary: Y.encodeStateAsUpdate(doc),
    stateVector: Y.encodeStateVector(doc),
    seq: snapshot.seq + 1,
  });
  return { patched: true };
}
