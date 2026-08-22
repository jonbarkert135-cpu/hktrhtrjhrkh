/**
 * Runs an AI capability against the local document (roadmap §16).
 *
 * The three deterministic capabilities need no endpoint, so they work in local mode (N2). Whatever
 * the run returns is a *result*, never a write: the proposal goes through the same review + apply
 * path as an integration import, which is what makes AI output previewable, reversible (one undo
 * step) and explainable.
 */

import {
  runCapability,
  unavailableProvider,
  type AICapabilityId,
  type AIRunResult,
} from '@nexus/ai';
import { listEdges, listNodes, newId } from '@nexus/domain';
import type * as Y from 'yjs';

export interface RunOnDocOptions {
  readonly boardId: string;
  readonly selectedIds?: readonly string[];
  readonly edgeId?: string;
  readonly actorUserId?: string;
  readonly now?: string;
}

export async function runAIOnDoc(
  doc: Y.Doc,
  capability: AICapabilityId,
  options: RunOnDocOptions,
): Promise<AIRunResult> {
  return runCapability(capability, {
    boardId: options.boardId,
    runId: newId.board(),
    now: options.now ?? new Date().toISOString(),
    actorUserId: options.actorUserId ?? 'local',
    graph: { nodes: listNodes(doc), edges: listEdges(doc) },
    // Local mode has no endpoint; a configured one arrives with the settings page.
    provider: unavailableProvider(),
    newId: () => newId.board(),
    ...(options.selectedIds === undefined ? {} : { nodeIds: options.selectedIds }),
    ...(options.edgeId === undefined ? {} : { edgeId: options.edgeId }),
  });
}
