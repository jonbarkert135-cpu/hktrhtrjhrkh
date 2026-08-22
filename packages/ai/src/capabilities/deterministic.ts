/**
 * The three capabilities that need no model at all (14_AI_AGENT.md §5): duplicate detection,
 * link suggestion and clustering are graph statistics, so they keep working when no AI endpoint
 * is configured — and their `explain` strings are exact, not model prose.
 */

import type { BoardNode } from '@nexus/domain';
import type { ProposalItem } from '@nexus/integrations/pipeline';

import { aiProvenance, buildAIProposal, edgeItem, existingRef } from '../proposal.ts';
import type { AICapability, AIFinding, AIRunContext, AIRunResult } from '../types.ts';

const STOP_CHARS = /[^\p{L}\p{N}]+/gu;

export function titleKey(node: BoardNode): string {
  return node.title.toLowerCase().replace(STOP_CHARS, ' ').trim();
}

export function tokens(value: string): Set<string> {
  return new Set(value.split(' ').filter((token) => token.length > 2));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

function urlOf(node: BoardNode): string | undefined {
  const url = node.data['url'];
  return typeof url === 'string' ? stripTrailingSlashes(url).toLowerCase() : undefined;
}

function targetNodes(ctx: AIRunContext): readonly BoardNode[] {
  const live = ctx.graph.nodes.filter((node) => node.status === 'active');
  if (ctx.nodeIds === undefined || ctx.nodeIds.length === 0) return live;
  const wanted = new Set(ctx.nodeIds);
  return live.filter((node) => wanted.has(node.id));
}

function connected(ctx: AIRunContext): Set<string> {
  const pairs = new Set<string>();
  for (const edge of ctx.graph.edges) {
    pairs.add(pairKey(edge.source.nodeId, edge.target.nodeId));
  }
  return pairs;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** §16 — "находить дубликаты": same URL, or a title overlap ≥ 0.8. */
export const findDuplicates: AICapability = {
  id: 'find-duplicates',
  needsProvider: false,
  description: 'Finds nodes that look like the same thing and proposes a same_as link.',
  run(ctx) {
    const nodes = targetNodes(ctx);
    const already = connected(ctx);
    const items: ProposalItem[] = [];
    const findings: AIFinding[] = [];

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i] as BoardNode;
        const b = nodes[j] as BoardNode;
        if (already.has(pairKey(a.id, b.id))) continue;
        const sameUrl = urlOf(a) !== undefined && urlOf(a) === urlOf(b);
        const overlap = jaccard(tokens(titleKey(a)), tokens(titleKey(b)));
        if (!sameUrl && overlap < 0.8) continue;
        const reason = sameUrl
          ? `both point at ${String(urlOf(a))}`
          : `titles overlap ${overlap.toFixed(2)}`;
        const provenance = aiProvenance({
          runId: ctx.runId,
          model: ctx.provider.modelId,
          now: ctx.now,
          actorUserId: ctx.actorUserId,
          confidence: sameUrl ? 0.95 : Number(overlap.toFixed(2)),
          explain: reason,
        });
        items.push(
          edgeItem(
            ctx.newId(),
            existingRef(a.id),
            existingRef(b.id),
            'same_as',
            provenance,
            `"${a.title}" ≈ "${b.title}": ${reason}.`,
          ),
        );
        findings.push({
          id: pairKey(a.id, b.id),
          title: `Possible duplicate: ${a.title} / ${b.title}`,
          detail: reason,
          nodeIds: [a.id, b.id],
        });
      }
    }
    return Promise.resolve(
      finish(ctx, 'find-duplicates', duplicatesText(findings.length), findings, items),
    );
  },
};

function duplicatesText(count: number): string {
  return count === 0
    ? 'No duplicate candidates: no two nodes share a URL or a near-identical title.'
    : `${String(count)} candidate pair(s) matched on URL equality or a title overlap ≥ 0.8. Nothing was written — accept the links you agree with.`;
}

/** §16 — "предлагать связи": shared tags between nodes that are not linked yet. */
export const suggestConnections: AICapability = {
  id: 'suggest-connections',
  needsProvider: false,
  description: 'Proposes related_to links between unconnected nodes that share tags.',
  run(ctx) {
    const nodes = targetNodes(ctx);
    const already = connected(ctx);
    const items: ProposalItem[] = [];
    const findings: AIFinding[] = [];

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i] as BoardNode;
        const b = nodes[j] as BoardNode;
        if (already.has(pairKey(a.id, b.id))) continue;
        const shared = a.tags.filter((tag) => b.tags.includes(tag));
        if (shared.length === 0) continue;
        const confidence = Math.min(0.9, 0.4 + shared.length * 0.2);
        const reason = `shared tag(s): ${shared.join(', ')}`;
        const provenance = aiProvenance({
          runId: ctx.runId,
          model: ctx.provider.modelId,
          now: ctx.now,
          actorUserId: ctx.actorUserId,
          confidence,
          explain: reason,
        });
        items.push(
          edgeItem(
            ctx.newId(),
            existingRef(a.id),
            existingRef(b.id),
            'related_to',
            provenance,
            `"${a.title}" and "${b.title}" ${reason}.`,
          ),
        );
        findings.push({
          id: pairKey(a.id, b.id),
          title: `${a.title} ↔ ${b.title}`,
          detail: reason,
          nodeIds: [a.id, b.id],
        });
      }
    }
    return Promise.resolve(
      finish(
        ctx,
        'suggest-connections',
        `${String(items.length)} suggestion(s) from shared tags. All of them are unselected by default; nothing is written until you accept.`,
        findings,
        items,
      ),
    );
  },
};

/** §16 — "кластеризовать информацию": read-only tag clusters, no graph write at all. */
export const clusterNodes: AICapability = {
  id: 'cluster-nodes',
  needsProvider: false,
  description: 'Groups the board into read-only tag clusters.',
  run(ctx) {
    const nodes = targetNodes(ctx);
    const byTag = new Map<string, BoardNode[]>();
    for (const node of nodes) {
      for (const tag of node.tags) {
        const bucket = byTag.get(tag) ?? [];
        bucket.push(node);
        byTag.set(tag, bucket);
      }
    }
    const findings: AIFinding[] = [...byTag.entries()]
      .filter(([, members]) => members.length > 1)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([tag, members]) => ({
        id: `cluster:${tag}`,
        title: `#${tag} — ${String(members.length)} nodes`,
        detail: members.map((node) => node.title).join(', '),
        nodeIds: members.map((node) => node.id),
      }));
    return Promise.resolve(
      finish(
        ctx,
        'cluster-nodes',
        `${String(findings.length)} tag cluster(s). This capability is read-only: it never proposes a write.`,
        findings,
        [],
      ),
    );
  },
};

function finish(
  ctx: AIRunContext,
  capability: AICapability['id'],
  explanation: string,
  findings: readonly AIFinding[],
  items: readonly ProposalItem[],
): AIRunResult {
  return {
    runId: ctx.runId,
    capability,
    model: ctx.provider.modelId,
    explanation,
    findings,
    ...(items.length === 0
      ? {}
      : {
          proposal: buildAIProposal({
            proposalId: ctx.newId(),
            runId: ctx.runId,
            boardId: ctx.boardId,
            now: ctx.now,
            items,
          }),
        }),
  };
}
