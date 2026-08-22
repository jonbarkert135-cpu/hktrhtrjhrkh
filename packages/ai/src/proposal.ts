/**
 * AI writes reach the graph only as an `ImportProposal` (N4, 14_AI_AGENT.md §1). Reusing the
 * integration proposal type is deliberate: the existing review UI previews it, `applyProposal`
 * writes it in one transaction, and undo reverses it — previewable, reversible, explainable
 * for free.
 */

import {
  PROPOSAL_TTL_MS,
  type ImportProposal,
  type NewEdgeItem,
  type NewNodeItem,
  type NodeRefOrTemp,
  type ProposalItem,
  type Provenance,
} from '@nexus/integrations/pipeline';

/** Manifest ids must be ≥ 3 chars; the AI layer is not an installable integration, only a source. */
export const AI_SOURCE_ID = 'nexus-ai';

export interface ProvenanceInput {
  readonly runId: string;
  readonly model: string;
  readonly now: string;
  readonly actorUserId: string;
  readonly confidence: number;
  readonly explain: string;
}

export function aiProvenance(input: ProvenanceInput): Provenance {
  return {
    source: `ai:${input.model}`,
    tool: AI_SOURCE_ID,
    toolVersion: '0.1.0',
    runId: input.runId,
    observedAt: input.now,
    importedAt: input.now,
    confidence: input.confidence,
    actorUserId: input.actorUserId,
    excerpt: input.explain.slice(0, 512),
  };
}

export function noteItem(
  tempId: string,
  title: string,
  text: string,
  provenance: Provenance,
  explain: string,
): NewNodeItem {
  return {
    id: tempId,
    kind: 'new_node',
    selectedByDefault: true,
    confidence: provenance.confidence,
    explain,
    node: {
      tempId,
      identityKey: `${AI_SOURCE_ID}:${tempId}`,
      nodeType: 'note',
      title,
      props: { text, aiRunId: provenance.runId, aiModel: provenance.source },
      tags: ['ai'],
      provenance,
    },
  };
}

export function edgeItem(
  tempId: string,
  fromRef: NodeRefOrTemp,
  toRef: NodeRefOrTemp,
  edgeType: string,
  provenance: Provenance,
  explain: string,
  selectedByDefault = false,
): NewEdgeItem {
  return {
    id: tempId,
    kind: 'new_edge',
    selectedByDefault,
    confidence: provenance.confidence,
    explain,
    edge: {
      tempId,
      fromRef,
      toRef,
      edgeType,
      label: edgeType.replace(/_/g, ' '),
      props: { aiRunId: provenance.runId },
      provenance,
    },
  };
}

export function existingRef(nodeId: string): NodeRefOrTemp {
  return { kind: 'existing', nodeId };
}

export function buildAIProposal(input: {
  readonly proposalId: string;
  readonly runId: string;
  readonly boardId: string;
  readonly now: string;
  readonly items: readonly ProposalItem[];
}): ImportProposal {
  return {
    id: input.proposalId,
    runId: input.runId,
    integrationId: AI_SOURCE_ID,
    boardId: input.boardId,
    createdAt: input.now,
    summary: {
      newNodes: input.items.filter((item) => item.kind === 'new_node').length,
      newEdges: input.items.filter((item) => item.kind === 'new_edge').length,
      enriched: 0,
      conflicts: 0,
      skippedDuplicates: 0,
    },
    items: input.items,
    issues: [],
    expiresAt: new Date(Date.parse(input.now) + PROPOSAL_TTL_MS).toISOString(),
  };
}
