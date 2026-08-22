/**
 * Group a selection and take it apart again (§19 of the roadmap). The Group *model* already exists
 * (`entities/group.ts`); what was missing is the one operation the UI needs: turn N selected nodes
 * into a frame that wraps them, and the inverse.
 */

import { createId } from '@paralleldrive/cuid2';
import type * as Y from 'yjs';

import { addGroup, getNode, listGroups, removeGroup } from '../doc/mutations.ts';
import type { Origin } from '../doc/transactions.ts';
import { makeGroup, type BoardGroup } from './group.ts';

export interface GroupOptions {
  readonly now: string;
  readonly origin?: Origin;
  readonly label?: string;
  readonly padding?: number;
  readonly makeId?: (() => string) | undefined;
}

/** Creates a frame around the given nodes. Returns null when fewer than two nodes exist. */
export function groupSelection(
  doc: Y.Doc,
  ids: readonly string[],
  options: GroupOptions,
): BoardGroup | null {
  const nodes = ids.flatMap((id) => {
    const node = getNode(doc, id);
    return node === undefined ? [] : [node];
  });
  if (nodes.length < 2) return null;

  const padding = options.padding ?? 24;
  const minX = Math.min(...nodes.map((node) => node.x)) - padding;
  const minY = Math.min(...nodes.map((node) => node.y)) - padding;
  const maxX = Math.max(...nodes.map((node) => node.x + node.w)) + padding;
  const maxY = Math.max(...nodes.map((node) => node.y + node.h)) + padding;

  const group = makeGroup(
    {
      id: (options.makeId ?? createId)(),
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      label: options.label ?? 'Group',
      childIds: nodes.map((node) => node.id),
    },
    options.now,
  );
  addGroup(doc, group, { origin: options.origin ?? 'local:action', now: options.now });
  return group;
}

/** Removes the group; its children survive with `parentId` cleared. */
export function ungroup(
  doc: Y.Doc,
  groupId: string,
  options: { now: string; origin?: Origin },
): boolean {
  return removeGroup(doc, groupId, {
    origin: options.origin ?? 'local:action',
    now: options.now,
  });
}

/** The group a node belongs to, if any — what the UI needs to offer "Ungroup" on a selection. */
export function groupOf(doc: Y.Doc, nodeId: string): BoardGroup | undefined {
  return listGroups(doc).find((group) => group.childIds.includes(nodeId));
}
