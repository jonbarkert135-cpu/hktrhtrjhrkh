/**
 * Internal clipboard for nodes and the edges between them (§18 of the roadmap, 03_UX.md §3).
 *
 * A clip is plain JSON so it can travel through the system clipboard as `text/plain` and survive a
 * tab reload or a second window; `parseClip` is the only trusted boundary and validates with the
 * entity schemas. Pasting mints fresh ids and remaps the internal edges, so copying part of a graph
 * keeps its shape (roadmap §18) while never colliding with the originals.
 */

import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';
import type * as Y from 'yjs';

import { tx, type Origin } from '../doc/transactions.ts';
import { EdgeSchema, type BoardEdge } from '../entities/edge.ts';
import { NodeSchema, type BoardNode } from '../entities/node.ts';
import { addEdges, addNodes, listEdges, listNodes, removeNodes } from '../doc/mutations.ts';

/** Marker so a pasted clip is recognised before the generic text detector sees it. */
export const CLIP_KIND = 'nexus/subgraph';

const ClipSourceSchema = z.object({
  boardId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  boardTitle: z.string().optional(),
});

/** Where a clip came from, so a paste into another board can keep the back-reference (§20). */
export interface ClipSource {
  readonly boardId: string;
  readonly projectId?: string | undefined;
  readonly boardTitle?: string | undefined;
}

export interface SubgraphClip {
  readonly kind: typeof CLIP_KIND;
  readonly version: 1;
  readonly nodes: readonly BoardNode[];
  readonly edges: readonly BoardEdge[];
  readonly source?: ClipSource;
}

/** Key under `node.data` holding the origin of a cross-board paste (§20 cross-project refs). */
export const REFERENCED_FROM = 'referencedFrom';

export interface PasteOptions {
  /** World point the clip's top-left corner lands on. */
  readonly at: { x: number; y: number };
  readonly now: string;
  readonly origin?: Origin;
  readonly makeId?: (() => string) | undefined;
  /** Board the clip lands in; when it differs from `clip.source`, nodes keep a back-reference. */
  readonly into?: ClipSource | undefined;
}

/** Nodes by id plus every edge whose both endpoints are in the selection. */
export function copySubgraph(
  doc: Y.Doc,
  ids: readonly string[],
  source?: ClipSource,
): SubgraphClip {
  const wanted = new Set(ids);
  const nodes = listNodes(doc).filter((node) => wanted.has(node.id));
  const kept = new Set(nodes.map((node) => node.id));
  const edges = listEdges(doc).filter(
    (edge) => kept.has(edge.source.nodeId) && kept.has(edge.target.nodeId),
  );
  return source === undefined
    ? { kind: CLIP_KIND, version: 1, nodes, edges }
    : { kind: CLIP_KIND, version: 1, nodes, edges, source };
}

/** Copy, then delete — one undo step, and the clip still holds the edges that went with them. */
export function cutSubgraph(
  doc: Y.Doc,
  ids: readonly string[],
  options: { now: string; origin?: Origin; source?: ClipSource | undefined },
): SubgraphClip {
  const clip = copySubgraph(doc, ids, options.source);
  if (clip.nodes.length > 0) {
    removeNodes(doc, [...clip.nodes.map((node) => node.id)], {
      origin: options.origin ?? 'local:delete',
      now: options.now,
    });
  }
  return clip;
}

export function serializeClip(clip: SubgraphClip): string {
  return JSON.stringify(clip);
}

/** Returns null for anything that is not one of our clips — callers fall back to normal paste. */
export function parseClip(text: string): SubgraphClip | null {
  if (!text.includes(CLIP_KIND)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as { kind?: unknown; nodes?: unknown; edges?: unknown; source?: unknown };
  if (record.kind !== CLIP_KIND || !Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    return null;
  }
  const nodes = NodeSchema.array().safeParse(record.nodes);
  const edges = EdgeSchema.array().safeParse(record.edges);
  if (!nodes.success || !edges.success) return null;
  const source = ClipSourceSchema.safeParse(record.source);
  return source.success
    ? { kind: CLIP_KIND, version: 1, nodes: nodes.data, edges: edges.data, source: source.data }
    : { kind: CLIP_KIND, version: 1, nodes: nodes.data, edges: edges.data };
}

/** A clip pasted into a different board keeps `data.referencedFrom` pointing back at its origin. */
function referenceOf(clip: SubgraphClip, into: ClipSource | undefined): ClipSource | undefined {
  const from = clip.source;
  if (from === undefined) return undefined;
  if (into !== undefined && into.boardId === from.boardId) return undefined;
  return from;
}

/** Writes the clip at `at` with fresh ids. Returns the new node ids in clip order. */
export function pasteSubgraph(
  doc: Y.Doc,
  clip: SubgraphClip,
  options: PasteOptions,
): { nodeIds: string[]; edgeIds: string[] } {
  if (clip.nodes.length === 0) return { nodeIds: [], edgeIds: [] };
  const mint = options.makeId ?? createId;
  const origin: Origin = options.origin ?? 'local:paste';
  const minX = Math.min(...clip.nodes.map((node) => node.x));
  const minY = Math.min(...clip.nodes.map((node) => node.y));
  const dx = options.at.x - minX;
  const dy = options.at.y - minY;

  const reference = referenceOf(clip, options.into);
  const idMap = new Map<string, string>();
  const nodes = clip.nodes.map((node) => {
    const id = mint();
    idMap.set(node.id, id);
    return NodeSchema.parse({
      ...node,
      id,
      data: reference === undefined ? node.data : { ...node.data, [REFERENCED_FROM]: reference },
      x: node.x + dx,
      y: node.y + dy,
      parentId: null,
      version: 1,
      createdAt: options.now,
      updatedAt: options.now,
      deletedAt: null,
    });
  });

  const edges = clip.edges.flatMap((edge) => {
    const source = idMap.get(edge.source.nodeId);
    const target = idMap.get(edge.target.nodeId);
    if (source === undefined || target === undefined) return [];
    return [
      EdgeSchema.parse({
        ...edge,
        id: mint(),
        source: { ...edge.source, nodeId: source },
        target: { ...edge.target, nodeId: target },
        version: 1,
        createdAt: options.now,
        updatedAt: options.now,
        deletedAt: null,
      }),
    ];
  });

  // One transaction: a paste of any size is a single undo step (N: one user action = one undo).
  tx(doc, origin, () => {
    addNodes(doc, nodes, { origin, now: options.now });
    if (edges.length > 0) addEdges(doc, edges, { origin, now: options.now });
  });
  return { nodeIds: nodes.map((node) => node.id), edgeIds: edges.map((edge) => edge.id) };
}
