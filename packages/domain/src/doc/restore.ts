/**
 * Snapshot restore (P3 §5.10). Restoring is a *new* operation applied on top of the current state —
 * it never rewrites history — so it merges cleanly with collaborators and is itself undoable.
 */

import * as Y from 'yjs';

import { boardRoots } from './schema.ts';
import { tx, type Origin } from './transactions.ts';

export interface RestoreReport {
  restored: number;
  removed: number;
}

/**
 * Replays `update` (a `Y.encodeStateAsUpdate` snapshot) into `doc`: records present in the snapshot
 * are rewritten, records created after it are removed, and `order` is reset to the snapshot's.
 */
export function restoreFromUpdate(
  doc: Y.Doc,
  update: Uint8Array,
  origin: Origin = 'local:action',
): RestoreReport {
  const scratch = new Y.Doc();
  Y.applyUpdate(scratch, update);
  const report: RestoreReport = { restored: 0, removed: 0 };

  tx(doc, origin, () => {
    const roots = boardRoots(doc);
    const targets = [
      [roots.nodes, scratch.getMap('nodes')],
      [roots.edges, scratch.getMap('edges')],
      [roots.groups, scratch.getMap('groups')],
    ] as const;

    for (const [live, past] of targets) {
      const snapshot = past.toJSON() as Record<string, Record<string, unknown>>;
      for (const id of [...live.keys()]) {
        if (!(id in snapshot)) {
          live.delete(id);
          report.removed += 1;
        }
      }
      for (const [id, value] of Object.entries(snapshot)) {
        const map = new Y.Map<unknown>();
        for (const [field, fieldValue] of Object.entries(value)) map.set(field, fieldValue);
        live.set(id, map);
        report.restored += 1;
      }
    }

    const order = roots.order;
    order.delete(0, order.length);
    order.push(scratch.getArray<string>('order').toArray());
  });

  return report;
}
