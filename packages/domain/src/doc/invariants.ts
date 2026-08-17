/**
 * `checkGraphInvariants(doc)` — the subset of 08_DATA_MODEL.md §7 that P3's schema can express.
 * Run on load, after import and in tests. Violations are reported, never thrown: a board that is
 * slightly inconsistent must still open (the repair path is `system:gc`, not a crash).
 */

import type * as Y from 'yjs';

import { boardRoots } from './schema.ts';

export type InvariantCode =
  | 'dangling-edge'
  | 'missing-parent'
  | 'asymmetric-group'
  | 'order-mismatch'
  | 'missing-fragment'
  | 'missing-provenance';

export interface InvariantViolation {
  code: InvariantCode;
  id: string;
  detail: string;
}

export function checkGraphInvariants(doc: Y.Doc): InvariantViolation[] {
  const roots = boardRoots(doc);
  const violations: InvariantViolation[] = [];
  const nodeIds = new Set<string>();
  roots.nodes.forEach((_map, id) => nodeIds.add(id));

  roots.edges.forEach((edge, id) => {
    for (const end of ['source', 'target'] as const) {
      const value = edge.get(end);
      const nodeId =
        typeof value === 'object' && value !== null ? (value as { nodeId?: unknown }).nodeId : null;
      if (typeof nodeId !== 'string' || !nodeIds.has(nodeId)) {
        violations.push({ code: 'dangling-edge', id, detail: `${end} node is missing` });
      }
    }
  });

  roots.nodes.forEach((node, id) => {
    const parentId = node.get('parentId');
    if (typeof parentId === 'string' && !roots.groups.has(parentId)) {
      violations.push({ code: 'missing-parent', id, detail: `group ${parentId} does not exist` });
    }
    if (node.get('provenance') === undefined) {
      violations.push({ code: 'missing-provenance', id, detail: 'node has no provenance' });
    }
    const data = node.get('data');
    const fragmentKey =
      typeof data === 'object' && data !== null
        ? (data as { fragmentKey?: unknown }).fragmentKey
        : undefined;
    if (typeof fragmentKey === 'string' && !roots.richtext.has(fragmentKey)) {
      violations.push({
        code: 'missing-fragment',
        id,
        detail: `fragment ${fragmentKey} is missing`,
      });
    }
  });

  roots.groups.forEach((group, id) => {
    const childIds = group.get('childIds');
    if (!Array.isArray(childIds)) return;
    for (const childId of childIds as unknown[]) {
      if (typeof childId !== 'string') continue;
      const child = roots.nodes.get(childId);
      if (child === undefined || child.get('parentId') !== id) {
        violations.push({
          code: 'asymmetric-group',
          id,
          detail: `child ${childId} does not point back at this group`,
        });
      }
    }
  });

  const order = roots.order.toArray();
  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id))
      violations.push({ code: 'order-mismatch', id, detail: 'duplicated in order' });
    else if (!nodeIds.has(id)) {
      violations.push({ code: 'order-mismatch', id, detail: 'order references a missing node' });
    }
    seen.add(id);
  }
  for (const id of nodeIds) {
    if (!seen.has(id))
      violations.push({ code: 'order-mismatch', id, detail: 'node is not in order' });
  }

  return violations;
}
