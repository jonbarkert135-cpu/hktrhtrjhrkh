/**
 * The board surface plus everything around it that P3 owns: document ⇄ canvas binding, the save
 * indicator, undo/redo, snapshots and export/import.
 *
 * The engine is created once; document changes reach it as incremental patches, never as a
 * re-render (P3 §7).
 */

import {
  countEntities,
  exportBoard,
  importBoard,
  newId,
  nodeBudget,
  observeBoard,
  serializeBoardExport,
  NODE_SOFT_LIMIT,
} from '@nexus/domain';
import { Banner, Button } from '@nexus/ui';
import type { Engine, Intent } from '@nexus/canvas-engine';
import { useCallback, useEffect, useState } from 'react';

import { useBoardDoc } from '../../data/docProvider.tsx';
import { restoreSnapshot } from '../../data/snapshots.ts';
import { CanvasHost } from '../canvas/CanvasHost';
import { applyIntent, createNoteNode } from '../canvas/bindings/applyIntents.ts';
import { patchesFromChange, sceneFromDoc } from '../canvas/bindings/sceneFromDoc.ts';
import { SyncStatus } from '../shell/SyncStatus.tsx';
import { ImportDialog, type ImportPreview } from './ImportDialog.tsx';
import { VersionHistory } from './VersionHistory.tsx';

const APP_VERSION = '0.3.0';

export function BoardWorkspace() {
  const { boardId, doc, history, status, snapshots, snapshotStore, ready, storageWarning, retry } =
    useBoardDoc();
  const [engine, setEngine] = useState<Engine | null>(null);
  const onEngine = useCallback((next: Engine | null) => setEngine(next), []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [budgetWarning, setBudgetWarning] = useState(false);
  const [counts, setCounts] = useState({ nodes: 0, edges: 0 });

  const now = useCallback(() => new Date().toISOString(), []);
  const context = { doc, history, now, makeId: (): string => newId.board() };
  const onIntent = useCallback(
    (intent: Intent) => {
      applyIntent(intent, { doc, history, now, makeId: (): string => newId.board() });
    },
    [doc, history, now],
  );

  // Document → engine: incremental patches, O(changed) per transaction.
  useEffect(() => {
    if (!ready || engine === null) return undefined;
    const scene = sceneFromDoc(doc);
    engine.applyScenePatch({ op: 'set-layers', layers: scene.layers });
    for (const node of scene.nodes) engine.applyScenePatch({ op: 'upsert-node', node });
    for (const edge of scene.edges) engine.applyScenePatch({ op: 'upsert-edge', edge });
    setCounts({ nodes: countEntities(doc).nodes, edges: countEntities(doc).edges });

    return observeBoard(doc, (change) => {
      const patches = patchesFromChange(doc, change);
      if (patches.length === 0) return;
      engine.applyScenePatch({ op: 'bulk', patches });
      setBudgetWarning(nodeBudget(doc).warn);
      setCounts({ nodes: countEntities(doc).nodes, edges: countEntities(doc).edges });
    });
  }, [doc, ready, engine]);

  // Undo/redo shortcuts (P3 §5.5).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history]);

  const addNote = useCallback(() => {
    if (nodeBudget(doc).blocked) {
      setNotice('This board is full. Split the investigation into a second board.');
      return;
    }
    // Drop the note in the middle of what the user is looking at, not at the world origin.
    const viewport = engine?.camera.viewportWorld;
    const at =
      viewport === undefined
        ? { x: 0, y: 0 }
        : { x: viewport.x + viewport.w / 2, y: viewport.y + viewport.h / 2 };
    createNoteNode(context, at);
    // `context` is rebuilt every render on purpose: it only holds the doc, history and clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, history, engine]);

  const download = useCallback(() => {
    const archive = exportBoard(doc, { appVersion: APP_VERSION, now: new Date().toISOString() });
    const blob = new Blob([serializeBoardExport(archive)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${archive.board.title || 'board'}.nexus.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [doc]);

  const confirmImport = useCallback(
    (preview: ImportPreview) => {
      // An import is preceded by a checkpoint, so one undo (or one restore) reverses it.
      void snapshots.capture('pre-import');
      const { report } = importBoard(preview.data, {
        mode: 'merge-into',
        into: doc,
        newId: () => newId.board(),
        now: new Date().toISOString(),
      });
      setImportOpen(false);
      setNotice(
        `Imported ${String(report.created.nodes)} nodes and ${String(report.created.edges)} edges.` +
          (report.warnings.length > 0 ? ` ${report.warnings[0] ?? ''}` : ''),
      );
    },
    [doc, snapshots],
  );

  const restore = useCallback(
    (id: string) => {
      void snapshotStore.load(id).then((record) => {
        if (record === null) return;
        restoreSnapshot(doc, record);
        setPreviewing(null);
        setHistoryOpen(false);
        setNotice('Version restored. Press ⌘Z to undo the restore.');
      });
    },
    [doc, snapshotStore],
  );

  return (
    <section className="nx-board" aria-label="Board">
      <header className="nx-board-bar">
        <Button onClick={addNote} data-testid="add-note">
          Add note
        </Button>
        <Button variant="secondary" onClick={() => setHistoryOpen(true)}>
          Version history
        </Button>
        <Button variant="secondary" onClick={download}>
          Export
        </Button>
        <Button variant="secondary" onClick={() => setImportOpen(true)}>
          Import
        </Button>
        <span className="nx-muted" data-testid="node-count" data-nodes={String(counts.nodes)}>
          {String(counts.nodes)} nodes · {String(counts.edges)} edges
        </span>
        <SyncStatus status={status} history={history} onRetry={() => retry()} onExport={download} />
      </header>

      {storageWarning !== null ? (
        <Banner kind="warn" title="Storage is limited on this device">
          {storageWarning}
        </Banner>
      ) : null}
      {budgetWarning ? (
        <Banner kind="warn" title="This board is getting large">
          Past {String(NODE_SOFT_LIMIT)} nodes the canvas slows down. Consider splitting it.
        </Banner>
      ) : null}
      {notice !== null ? (
        <Banner kind="info" title="Board updated">
          {notice}
        </Banner>
      ) : null}

      <CanvasHost onIntent={onIntent} onEngine={onEngine} />

      <VersionHistory
        open={historyOpen}
        boardId={boardId}
        store={snapshotStore}
        onOpenChange={setHistoryOpen}
        onPreview={setPreviewing}
        onRestore={restore}
        previewingId={previewing}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onConfirm={confirmImport} />
    </section>
  );
}
