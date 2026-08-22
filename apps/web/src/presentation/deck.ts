/**
 * §31 — a presentation is derived, never stored: the slides are the selected nodes in selection
 * order plus a closing conclusion. Nothing is copied, so editing a node updates the deck and a
 * presentation can never go stale (N2).
 */

import type { BoardEdge, BoardNode } from '@nexus/domain';

export interface Slide {
  id: string;
  kind: 'step' | 'conclusion';
  title: string;
  body: string;
  /** Node ids the slide focuses on, so the host can pan the camera to them. */
  focus: string[];
}

export interface DeckOptions {
  selectedIds: readonly string[];
  conclusion?: string;
}

function bodyOf(node: BoardNode, edges: readonly BoardEdge[]): string {
  const links = edges.filter(
    (edge) => edge.source.nodeId === node.id || edge.target.nodeId === node.id,
  ).length;
  const parts = [node.type];
  if (node.provenance.source !== null) parts.push(node.provenance.source);
  parts.push(`confidence ${node.confidence}`, `${String(links)} connections`);
  return parts.join(' · ');
}

export function buildDeck(
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
  options: DeckOptions,
): Slide[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chosen =
    options.selectedIds.length > 0
      ? options.selectedIds
      : nodes.filter((node) => node.starred).map((node) => node.id);

  const steps: Slide[] = chosen.flatMap((id, index) => {
    const node = byId.get(id);
    if (node === undefined) return [];
    return [
      {
        id,
        kind: 'step' as const,
        title: `Step ${String(index + 1)} — ${node.title || node.type}`,
        body: bodyOf(node, edges),
        focus: [id],
      },
    ];
  });

  if (steps.length === 0) return [];

  const conclusion = options.conclusion?.trim() ?? '';
  steps.push({
    id: 'conclusion',
    kind: 'conclusion',
    title: 'Conclusion',
    body:
      conclusion === ''
        ? `${String(steps.length)} steps reviewed. Add a conclusion in the inspector to close the story.`
        : conclusion,
    focus: steps.map((slide) => slide.id),
  });
  return steps;
}
