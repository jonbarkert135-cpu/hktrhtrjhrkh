/**
 * The sync-service projection diff (P8, 08_DATA_MODEL.md §5.2/§5.3, scoped to `nodes`/`edges` —
 * `groups`/`node_tags`/`entity_resolutions`/`history_events` are a superset left to a later phase,
 * see RAVEN-SPEC/20_ROADMAP.md P8 implementation-status).
 *
 * Pure, framework-free: reads a `Y.Doc`'s `nodes`/`edges` roots and produces the row-level changes
 * a projector must apply. No I/O — `packages/domain` never touches Postgres.
 */

import type * as Y from 'yjs';

import { EdgeSchema, type BoardEdge } from '../entities/edge.ts';
import { NodeSchema, type BoardNode } from '../entities/node.ts';
import { boardRoots } from '../doc/schema.ts';

/** What a projector must do to bring `nodes`/`edges` rows in line with the doc. */
export interface ProjectionDiff {
  upsertNodes: BoardNode[];
  deleteNodeIds: string[];
  upsertEdges: BoardEdge[];
  deleteEdgeIds: string[];
}

/** The projector's view of one already-projected row — enough to apply the ordering guard. */
export interface ProjectedRowRef {
  id: string;
  version: number;
  updatedAt: string;
}

export interface PriorProjectionState {
  nodes: ReadonlyMap<string, ProjectedRowRef>;
  edges: ReadonlyMap<string, ProjectedRowRef>;
}

export const emptyProjectionState = (): PriorProjectionState => ({
  nodes: new Map(),
  edges: new Map(),
});

function parseEntity<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  raw: unknown,
): T | null {
  const parsed = schema.safeParse(raw);
  return parsed.success && parsed.data !== undefined ? parsed.data : null;
}

/**
 * A row moves forward only if the incoming doc entry is newer (08_DATA_MODEL.md §5.3): higher
 * `version`, or same `version` with a later `updatedAt`. This is what makes projection idempotent
 * — replaying the same document twice never re-issues a row that already reflects it.
 */
export function isNewer(
  prior: ProjectedRowRef | undefined,
  next: { version: number; updatedAt: string },
): boolean {
  if (!prior) return true;
  if (next.version > prior.version) return true;
  if (next.version === prior.version && next.updatedAt > prior.updatedAt) return true;
  return false;
}

/**
 * Computes the full diff needed to project `doc` given what was projected last (`prior`).
 * Deliberately a full-scan diff (not an incremental Yjs-update decode): §5.2's "changed set from
 * the update" is an optimization the sync service applies on top (see `apps/sync/src/projection.ts`
 * `changedSince`); this function is the ground truth both the incremental path and `reproject.ts`
 * converge on, which is what keeps the two replayable into the same result.
 */
export function diffBoardDoc(doc: Y.Doc, prior: PriorProjectionState): ProjectionDiff {
  const roots = boardRoots(doc);
  const upsertNodes: BoardNode[] = [];
  const upsertEdges: BoardEdge[] = [];

  const liveNodeIds = new Set<string>();
  for (const [id, map] of roots.nodes.entries()) {
    liveNodeIds.add(id);
    const node = parseEntity<BoardNode>(NodeSchema, map.toJSON());
    if (!node) continue; // validation failures are handled by the sync-service caller (§5.4)
    if (isNewer(prior.nodes.get(id), node)) upsertNodes.push(node);
  }

  const liveEdgeIds = new Set<string>();
  for (const [id, map] of roots.edges.entries()) {
    liveEdgeIds.add(id);
    const edge = parseEntity<BoardEdge>(EdgeSchema, map.toJSON());
    if (!edge) continue;
    if (isNewer(prior.edges.get(id), edge)) upsertEdges.push(edge);
  }

  const deleteNodeIds = [...prior.nodes.keys()].filter((id) => !liveNodeIds.has(id));
  const deleteEdgeIds = [...prior.edges.keys()].filter((id) => !liveEdgeIds.has(id));

  return { upsertNodes, deleteNodeIds, upsertEdges, deleteEdgeIds };
}

/** Folds a diff into the next `PriorProjectionState`, used to chain incremental projections. */
export function applyDiffToState(
  state: PriorProjectionState,
  diff: ProjectionDiff,
): PriorProjectionState {
  const nodes = new Map(state.nodes);
  for (const node of diff.upsertNodes) {
    nodes.set(node.id, { id: node.id, version: node.version, updatedAt: node.updatedAt });
  }
  for (const id of diff.deleteNodeIds) nodes.delete(id);

  const edges = new Map(state.edges);
  for (const edge of diff.upsertEdges) {
    edges.set(edge.id, { id: edge.id, version: edge.version, updatedAt: edge.updatedAt });
  }
  for (const id of diff.deleteEdgeIds) edges.delete(id);

  return { nodes, edges };
}
