/**
 * Applies a `ProjectionDiff` to a row store. `packages/domain` only defines the shape of the
 * store (`ProjectionStore`) and the pure apply function; `apps/sync` supplies the Postgres-backed
 * implementation, tests supply an in-memory one — this is what makes the diff/apply pair testable
 * without a database (18_TESTING.md §3, `packages/domain/test/projection.diff.test.ts`).
 */

import type { BoardEdge } from '../entities/edge.ts';
import type { BoardNode } from '../entities/node.ts';
import { diffBoardDoc, emptyProjectionState, type PriorProjectionState } from './diffDoc.ts';
import type * as Y from 'yjs';

export interface ProjectionStore {
  upsertNode(node: BoardNode): void;
  deleteNode(id: string): void;
  upsertEdge(edge: BoardEdge): void;
  deleteEdge(id: string): void;
}

/** An in-memory `ProjectionStore` — the one `apps/sync`'s unit tests and this package's property
 * test both use so "diff+apply == full projection" is checked against the same reference. */
export class MemoryProjectionStore implements ProjectionStore {
  readonly nodes = new Map<string, BoardNode>();
  readonly edges = new Map<string, BoardEdge>();

  upsertNode(node: BoardNode): void {
    this.nodes.set(node.id, node);
  }

  deleteNode(id: string): void {
    this.nodes.delete(id);
  }

  upsertEdge(edge: BoardEdge): void {
    this.edges.set(edge.id, edge);
  }

  deleteEdge(id: string): void {
    this.edges.delete(id);
  }

  /** A `PriorProjectionState` view of the current rows, for chaining the next diff. */
  toProjectionState(): PriorProjectionState {
    const nodes = new Map(
      [...this.nodes.values()].map((n) => [
        n.id,
        { id: n.id, version: n.version, updatedAt: n.updatedAt },
      ]),
    );
    const edges = new Map(
      [...this.edges.values()].map((e) => [
        e.id,
        { id: e.id, version: e.version, updatedAt: e.updatedAt },
      ]),
    );
    return { nodes, edges };
  }
}

/** Applies one diff to a store — the only place rows are written. */
export function applyProjectionDiff(
  store: ProjectionStore,
  diff: ReturnType<typeof diffBoardDoc>,
): void {
  for (const node of diff.upsertNodes) store.upsertNode(node);
  for (const id of diff.deleteNodeIds) store.deleteNode(id);
  for (const edge of diff.upsertEdges) store.upsertEdge(edge);
  for (const id of diff.deleteEdgeIds) store.deleteEdge(id);
}

/**
 * Projects a whole document into a fresh store from scratch — what `scripts/reproject.ts` does
 * per board (08_DATA_MODEL.md §5.5). Used as the "ground truth" reference in tests and as the
 * actual replay path.
 */
export function fullProject(doc: Y.Doc, store: ProjectionStore): void {
  const diff = diffBoardDoc(doc, emptyProjectionState());
  applyProjectionDiff(store, diff);
}
