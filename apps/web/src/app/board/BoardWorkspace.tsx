/**
 * The board surface plus everything around it that P3 owns: document ⇄ canvas binding, the save
 * indicator, undo/redo, snapshots and export/import.
 *
 * The engine is created once; document changes reach it as incremental patches, never as a
 * re-render (P3 §7).
 */

import {
  countEntities,
  deleteNode,
  duplicateNode,
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
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useBoardDoc } from '../../data/docProvider.tsx';
import { restoreSnapshot } from '../../data/snapshots.ts';
import { CanvasHost } from '../canvas/CanvasHost';
import { applyIntent, connectToEmpty, createNoteNode } from '../canvas/bindings/applyIntents.ts';
import { EdgeLayer, pendingFromIntent, type PendingEdgeUi } from '../../edges/EdgeLayer.tsx';
import { BoardInspector } from './BoardInspector.tsx';
import { patchesFromChange, sceneFromDoc } from '../canvas/bindings/sceneFromDoc.ts';
import { NodeHosts } from '../../nodes/NodeHosts.tsx';
import { createNodeStore } from '../../nodes/nodeStore.ts';
import { SyncStatus } from '../shell/SyncStatus.tsx';
import { useBoardStatus } from '../shell/boardStatus.tsx';
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
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [inspectorWidth, setInspectorWidth] = useState(360);

  const boardStatus = useBoardStatus();

  // One store per document: cards subscribe per node id, so an edit re-renders one card (P4 §7).
  const store = useMemo(() => createNodeStore(doc), [doc]);
  useEffect(() => () => store.destroy(), [store]);

  const now = useCallback(() => new Date().toISOString(), []);
  const report = useCallback((message: string) => setNotice(message), []);
  const context = { doc, history, now, makeId: (): string => newId.board(), onNotice: report };
  const intentContext = useCallback(
    () => ({ doc, history, now, makeId: (): string => newId.board(), onNotice: report }),
    [doc, history, now, report],
  );
  // The relationship menus open at a world point; the screen position is only available inside the
  // canvas render prop, so the intent handler stores world coordinates and `EdgeLayer` converts.
  const [pendingMenu, setPendingMenu] = useState<PendingEdgeUi | null>(null);

  const onIntent = useCallback(
    (intent: Intent) => {
      const pending = pendingFromIntent(intent);
      if (pending !== null) {
        setPendingMenu(pending);
        return;
      }
      applyIntent(intent, intentContext());
    },
    [intentContext],
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

  // The status bar belongs to the shell but the numbers belong here (see shell/boardStatus).
  useEffect(() => {
    boardStatus.publish({ counts });
    // `publish` is stable enough for this: it de-duplicates identical values itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.nodes, counts.edges]);

  // Selection lives in the engine (it is per-user state, never in the CRDT); the panel mirrors it.
  useEffect(() => {
    if (engine === null) return undefined;
    return engine.on('selectionChanged', (ids) => setSelectedIds([...ids]));
  }, [engine]);

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

  const finishDrop = useCallback(
    (from: string, at: { x: number; y: number }) => {
      connectToEmpty(intentContext(), from, at);
      setPendingMenu(null);
    },
    [intentContext],
  );

  const download = useCallback(() => {
    const archive = exportBoard(doc, { appVersion: APP_VERSION, now: new Date().toISOString() });
    const blob = new Blob([serializeBoardExport(archive)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${archive.board.title || 'board'}.raven.json`;
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

      <div className="nx-board-main">
        <CanvasHost onIntent={onIntent} onEngine={onEngine} nodeCount={counts.nodes}>
          {({ slotOf, screenOf }) => (
            <>
              <NodeHosts
                engine={engine}
                doc={doc}
                store={store}
                slotOf={slotOf}
                selectedIds={selectedIds}
                onOpenInspector={(id) => setSelectedIds([id])}
                onDuplicate={(id) => {
                  duplicateNode(doc, id, { now: new Date().toISOString() });
                }}
                onDelete={(id) => {
                  deleteNode(doc, id, { now: new Date().toISOString() });
                }}
              />
              <EdgeLayer
                doc={doc}
                context={context}
                pending={pendingMenu}
                screenOf={screenOf}
                onClose={() => setPendingMenu(null)}
                onConnectToEmpty={finishDrop}
                onEditLabel={(id) => setSelectedIds([id])}
                onResult={(result) => {
                  if (result.message !== null) setNotice(result.message);
                }}
              />
            </>
          )}
        </CanvasHost>

        <BoardInspector
          doc={doc}
          store={store}
          selectedIds={selectedIds}
          context={context}
          width={inspectorWidth}
          onWidthChange={setInspectorWidth}
          onClose={() => setSelectedIds([])}
          onEdgeDeleted={() => setSelectedIds([])}
        />
      </div>

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
