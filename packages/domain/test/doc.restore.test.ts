/**
 * Snapshot restore (P3 §5.10): restoring is a forward operation — it rewrites what the snapshot
 * knew, removes what came after it, and stays undoable like any other local edit.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { createBoardDoc } from '../src/doc/createBoardDoc.ts';
import { addNodes, getNode, listNodes, removeNodes, updateNode } from '../src/doc/mutations.ts';
import { restoreFromUpdate } from '../src/doc/restore.ts';
import { boardRoots } from '../src/doc/schema.ts';
import { createBoardHistory } from '../src/history/undoManager.ts';
import { T0, fixtureNode } from './doc-fixtures.ts';

const local = { origin: 'local:create', now: T0 } as const;
const ids = (doc: Y.Doc): string[] => listNodes(doc).map((node) => node.id);

describe('restoreFromUpdate', () => {
  it('brings back deleted records, drops later ones and rewinds edits', () => {
    const doc = createBoardDoc({ boardId: 'b_restore', now: T0 });
    addNodes(doc, [fixtureNode('n1', 0), fixtureNode('n2', 1)], local);
    const snapshot = Y.encodeStateAsUpdate(doc);

    removeNodes(doc, ['n1'], { origin: 'local:delete', now: T0 });
    updateNode(
      doc,
      'n2',
      { title: 'edited after the snapshot' },
      { origin: 'local:edit', now: T0 },
    );
    addNodes(doc, [fixtureNode('n3', 2)], local);

    const report = restoreFromUpdate(doc, snapshot);

    expect(ids(doc).sort()).toEqual(['n1', 'n2']);
    expect(report.removed).toBe(1);
    expect(report.restored).toBe(2);
    expect(getNode(doc, 'n2')?.title).toBe(fixtureNode('n2', 1).title);
    expect(boardRoots(doc).order.toArray()).toEqual(['n1', 'n2']);
  });

  it('is itself one undo step', () => {
    const doc = createBoardDoc({ boardId: 'b_restore_undo', now: T0 });
    addNodes(doc, [fixtureNode('n1', 0)], local);
    const snapshot = Y.encodeStateAsUpdate(doc);
    const history = createBoardHistory(doc, { captureTimeout: 0 });

    addNodes(doc, [fixtureNode('n2', 1)], local);
    restoreFromUpdate(doc, snapshot);
    expect(ids(doc)).toEqual(['n1']);

    expect(history.undo()).toBe(true);
    expect(ids(doc).sort()).toEqual(['n1', 'n2']);
    history.destroy();
  });

  it('leaves a document that already matches the snapshot unchanged', () => {
    const doc = createBoardDoc({ boardId: 'b_restore_noop', now: T0 });
    addNodes(doc, [fixtureNode('n1', 0)], local);
    const snapshot = Y.encodeStateAsUpdate(doc);

    const report = restoreFromUpdate(doc, snapshot, 'local:proposal-apply');

    expect(report).toEqual({ restored: 1, removed: 0 });
    expect(ids(doc)).toEqual(['n1']);
  });
});
