/**
 * Link suggestions (00_GOAL.md): two nodes that carry the same identifier — a domain, an email,
 * a handle or a tag — are almost always the same story, but nothing on the board says so until
 * an analyst notices it by eye. This finds those pairs from data already on the board, so the
 * suggestion is always explainable by the token it matched on.
 */

import type { BoardEdge } from '../entities/edge.ts';
import type { BoardNode } from '../entities/node.ts';

export interface LinkSuggestion {
  /** The two node ids, sorted, so a pair is suggested once regardless of who found it. */
  sourceId: string;
  targetId: string;
  /** The shared values that motivate the suggestion, strongest first. */
  evidence: string[];
}

/** Tokens this generic (`example.com` on ten nodes) stop being evidence of anything. */
const MAX_NODES_PER_TOKEN = 6;

const DOMAIN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/g;
const EMAIL = /\b[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}\b/g;
const HANDLE = /(?:^|\s)@([a-z0-9_.]{3,})\b/g;

function textOf(node: BoardNode): string {
  const parts = [node.title];
  for (const value of Object.values(node.data)) {
    if (typeof value === 'string') parts.push(value);
  }
  return parts.join('\n').toLowerCase();
}

/** Identifiers a node carries: its tags plus every email, handle and domain in its text. */
export function identifiersOf(node: BoardNode): Set<string> {
  const text = textOf(node);
  const found = new Set<string>();
  for (const tag of node.tags) found.add(`tag:${tag.toLowerCase()}`);
  for (const [match] of text.matchAll(EMAIL)) found.add(match);
  for (const [, handle] of text.matchAll(HANDLE)) found.add(`@${handle}`);
  for (const [match] of text.matchAll(DOMAIN)) {
    // A domain already counted inside an email address is not separate evidence.
    if (![...found].some((seen) => seen.endsWith(`@${match}`))) found.add(match);
  }
  return found;
}

/**
 * Pairs of live nodes that share at least one identifier and are not connected yet, most
 * evidence first. Deterministic: ties break on node ids so the list never reshuffles itself.
 */
export function suggestLinks(
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
  options: { limit?: number } = {},
): LinkSuggestion[] {
  const live = nodes.filter((node) => node.status === 'active');
  const connected = new Set(
    edges.map((edge) => [edge.source.nodeId, edge.target.nodeId].sort().join('\u0000')),
  );

  const byToken = new Map<string, string[]>();
  for (const node of live) {
    for (const token of identifiersOf(node)) {
      const list = byToken.get(token);
      if (list === undefined) byToken.set(token, [node.id]);
      else list.push(node.id);
    }
  }

  const pairs = new Map<string, LinkSuggestion>();
  for (const [token, ids] of byToken) {
    if (ids.length < 2 || ids.length > MAX_NODES_PER_TOKEN) continue;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const [sourceId, targetId] = [ids[i] as string, ids[j] as string].sort() as [
          string,
          string,
        ];
        const key = `${sourceId}\u0000${targetId}`;
        if (connected.has(key)) continue;
        const existing = pairs.get(key);
        if (existing === undefined) pairs.set(key, { sourceId, targetId, evidence: [token] });
        else existing.evidence.push(token);
      }
    }
  }

  for (const pair of pairs.values()) pair.evidence.sort();
  return [...pairs.values()]
    .sort(
      (a, b) =>
        b.evidence.length - a.evidence.length ||
        a.sourceId.localeCompare(b.sourceId) ||
        a.targetId.localeCompare(b.targetId),
    )
    .slice(0, options.limit ?? 20);
}
