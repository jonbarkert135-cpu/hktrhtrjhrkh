/**
 * Group / ungroup the current selection (roadmap §19). Kept out of the component so the rules are
 * testable without a canvas: each call is one document write and returns the line the toast shows.
 */

import { groupOf, groupSelection, ungroup } from '@nexus/domain';
import type * as Y from 'yjs';

export interface GroupContext {
  doc: Y.Doc;
  history: { label(text: string): void; separate(): void };
  now: () => string;
}

export function groupSelected(context: GroupContext, ids: readonly string[]): string {
  if (ids.length < 2) return 'Select at least two nodes to group them.';
  context.history.label('group');
  const group = groupSelection(context.doc, ids, { now: context.now() });
  context.history.separate();
  return group === null ? 'Nothing to group.' : `Grouped ${String(group.childIds.length)} nodes`;
}

export function ungroupSelected(context: GroupContext, ids: readonly string[]): string {
  const group = ids.map((id) => groupOf(context.doc, id)).find((found) => found !== undefined);
  if (group === undefined) return 'The selection is not in a group.';
  context.history.label('ungroup');
  ungroup(context.doc, group.id, { now: context.now() });
  context.history.separate();
  return `Ungrouped ${group.label === '' ? 'the group' : group.label}`;
}
