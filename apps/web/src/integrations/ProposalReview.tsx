/**
 * The proposal diff (10_INTEGRATIONS.md §7.2 step 5).
 *
 * Grouped by item kind with per-item selection; conflicts start unselected because they need a
 * decision, not a default. Every row carries a "why is this here" provenance chip — tool, run and
 * confidence bucket — since an imported node with no visible origin is exactly what N4 forbids.
 */

import { bucketOf } from '@nexus/integrations';
import type { ImportProposal, NodeRefOrTemp, ProposalItem } from '@nexus/integrations';
import { Button } from '@nexus/ui';
import { useState } from 'react';

export interface ProposalReviewProps {
  proposal: ImportProposal;
  integrationName: string;
  onApply: (selectedItemIds: string[]) => void;
  onDiscard: () => void;
}

const SECTIONS = [
  { kind: 'new_node', title: 'New nodes' },
  { kind: 'new_edge', title: 'New edges' },
  { kind: 'enrich', title: 'Enriched fields' },
  { kind: 'conflict', title: 'Conflicts' },
] as const;

const refLabel = (ref: NodeRefOrTemp): string =>
  ref.kind === 'existing' ? ref.nodeId : ref.tempId;

export function itemLabel(item: ProposalItem): string {
  switch (item.kind) {
    case 'new_node':
      return item.node.title;
    case 'new_edge':
      return `${refLabel(item.edge.fromRef)} —[${item.edge.edgeType}]→ ${refLabel(item.edge.toRef)}`;
    case 'enrich':
      return item.fieldPatches.map((patch) => `${patch.path}: → ${String(patch.value)}`).join(', ');
    case 'conflict':
      return `${item.field}: ${String(item.currentValue)} vs ${String(item.incomingValue)}`;
  }
}

export function defaultSelection(proposal: ImportProposal): string[] {
  return proposal.items
    .filter((item) => item.kind !== 'conflict' && item.selectedByDefault)
    .map((item) => item.id);
}

export function ProposalReview({
  proposal,
  integrationName,
  onApply,
  onDiscard,
}: ProposalReviewProps) {
  const [selected, setSelected] = useState<string[]>(() => defaultSelection(proposal));

  const toggle = (id: string): void =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  if (proposal.items.length === 0) {
    return (
      <section aria-label="Results" data-testid="proposal-review">
        <p data-testid="proposal-empty">
          {integrationName} found nothing to add. The target already matches what is on the board,
          so there is no change to propose — open the run log to see what it checked.
        </p>
        <Button variant="secondary" onClick={onDiscard}>
          Close
        </Button>
      </section>
    );
  }

  return (
    <section aria-label="Results" data-testid="proposal-review">
      <div>
        <Button variant="secondary" onClick={() => setSelected(proposal.items.map((i) => i.id))}>
          Select all
        </Button>
        <Button variant="secondary" onClick={() => setSelected([])}>
          Select none
        </Button>
      </div>

      {SECTIONS.map((section) => {
        const items = proposal.items.filter((item) => item.kind === section.kind);
        if (items.length === 0) return null;
        return (
          <div key={section.kind} data-testid={`section-${section.kind}`}>
            <h3>
              {section.title} ({String(items.length)})
            </h3>
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggle(item.id)}
                      aria-label={itemLabel(item)}
                    />
                    {itemLabel(item)}
                  </label>
                  <span className="nx-chip" title={item.explain} data-testid="provenance-chip">
                    {integrationName} · run {proposal.runId} · {bucketOf(item.confidence)}{' '}
                    confidence
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <footer>
        <span data-testid="proposal-footer">
          Applying {String(selected.length)} of {String(proposal.items.length)} items
        </span>
        <Button variant="secondary" onClick={onDiscard}>
          Discard
        </Button>
        <Button disabled={selected.length === 0} onClick={() => onApply(selected)}>
          Apply
        </Button>
      </footer>
    </section>
  );
}
