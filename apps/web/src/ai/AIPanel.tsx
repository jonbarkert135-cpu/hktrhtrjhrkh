/**
 * The AI assistant panel (roadmap §16). Every run shows *why* it produced what it produced, and a
 * run that wants to change the board hands the change to `ProposalReview` — accept per item, apply
 * as one undo step, or discard. Capabilities that need a model endpoint are listed but disabled
 * until one is configured, instead of silently doing nothing.
 */

import { availableCapabilities, type AICapabilityId, type AIRunResult } from '@nexus/ai';
import { newId } from '@nexus/domain';
import { applyProposal } from '@nexus/integrations';
import { Button } from '@nexus/ui';
import { useCallback, useState } from 'react';
import type * as Y from 'yjs';

import { ProposalReview } from '../integrations/ProposalReview.tsx';
import { runAIOnDoc } from './runOnDoc.ts';

export interface AIPanelProps {
  open: boolean;
  onClose: () => void;
  doc: Y.Doc;
  boardId: string;
  selectedIds: readonly string[];
  onUndo: () => void;
  /** True once an OpenAI-compatible endpoint is configured; local mode has none. */
  hasProvider?: boolean;
}

export function AIPanel({
  open,
  onClose,
  doc,
  boardId,
  selectedIds,
  onUndo,
  hasProvider = false,
}: AIPanelProps) {
  const [result, setResult] = useState<AIRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const run = useCallback(
    async (id: AICapabilityId) => {
      setError(null);
      setApplied(null);
      setResult(null);
      try {
        setResult(await runAIOnDoc(doc, id, { boardId, selectedIds }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The AI run failed.');
      }
    },
    [doc, boardId, selectedIds],
  );

  const apply = useCallback(
    (selectedItemIds: string[]) => {
      if (result?.proposal === undefined) return;
      const outcome = applyProposal(doc, result.proposal, {
        selectedItemIds,
        conflictResolutions: {},
        placement: 'radial',
        newId: () => newId.board(),
        now: new Date().toISOString(),
      });
      setApplied(
        `Applied ${String(outcome.createdNodeIds.length)} node(s) and ${String(outcome.createdEdgeIds.length)} edge(s).`,
      );
      setResult(null);
    },
    [doc, result],
  );

  if (!open) return null;

  return (
    <aside className="nx-ai" aria-label="AI assistant" data-testid="ai-panel">
      <button type="button" onClick={onClose} aria-label="Close AI assistant">
        Close
      </button>

      {!hasProvider ? (
        <p>
          No AI endpoint is configured, so only the capabilities that need no model are available.
        </p>
      ) : null}

      <ul>
        {availableCapabilities(hasProvider).map((capability) => (
          <li key={capability.id}>
            <Button
              onClick={() => {
                void run(capability.id);
              }}
            >
              {capability.id}
            </Button>
            <span>{capability.description}</span>
          </li>
        ))}
      </ul>

      {error !== null ? <p role="alert">{error}</p> : null}
      {applied !== null ? (
        <p role="status">
          {applied} <Button onClick={onUndo}>Undo</Button>
        </p>
      ) : null}

      {result !== null ? (
        <section aria-label="AI result">
          <p data-testid="ai-explanation">{result.explanation}</p>
          <ul>
            {result.findings.map((finding) => (
              <li key={finding.id}>
                <strong>{finding.title}</strong>
                <span>{finding.detail}</span>
              </li>
            ))}
          </ul>
          {result.proposal !== undefined ? (
            <ProposalReview
              proposal={result.proposal}
              integrationName="AI assistant"
              onApply={apply}
              onDiscard={() => setResult(null)}
            />
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}
