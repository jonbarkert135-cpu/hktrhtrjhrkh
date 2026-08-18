/**
 * React ⇄ overlay bridge (P4 §7). The engine decides *which* nodes deserve a DOM host and owns the
 * slot elements; React renders a card into each slot through a portal. Neither side learns about
 * the other's model: the engine emits ids, React reads those nodes from the store.
 */

import { builtinNodeTypes } from '@nexus/domain';
import type { Engine } from '@nexus/canvas-engine';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type * as Y from 'yjs';

import { NodeCard, type NodeCardActions } from './NodeCard.tsx';
import type { NodeStore } from './nodeStore.ts';
import { LazyRichTextEditor } from './richtext/LazyRichTextEditor.tsx';

/** Above this zoom a card shows descriptions and full badges (05_CANVAS_ENGINE.md §5, L3). */
export const DETAIL_ZOOM = 1.6;

export interface NodeHostsProps extends NodeCardActions {
  engine: Engine | null;
  store: NodeStore;
  /** Needed only to bind the in-place editor; cards themselves never see the document. */
  doc: Y.Doc;
  /** Slot lookup, supplied by the canvas hook that owns the overlay. */
  slotOf: (id: string) => HTMLElement | undefined;
  selectedIds?: readonly string[];
}

function HostedCard({
  id,
  doc,
  store,
  slot,
  detailed,
  selected,
  multiSelected,
  editing,
  onEndEdit,
  actions,
}: {
  id: string;
  doc: Y.Doc;
  store: NodeStore;
  slot: HTMLElement;
  detailed: boolean;
  selected: boolean;
  multiSelected: boolean;
  editing: boolean;
  onEndEdit: () => void;
  actions: NodeCardActions;
}) {
  const node = useSyncExternalStore(
    (listener) => store.subscribe(id, listener),
    () => store.getSnapshot(id),
    () => store.getSnapshot(id),
  );
  if (node === undefined) return null;
  return createPortal(
    <NodeCard
      node={node}
      detailed={detailed}
      context={{ selected, multiSelected }}
      {...(editing
        ? {
            editorSlot: (
              <LazyRichTextEditor
                doc={doc}
                node={node}
                focusOnMount
                toolbar={false}
                onExit={onEndEdit}
              />
            ),
          }
        : {})}
      {...actions}
    />,
    slot,
  );
}

export function NodeHosts({
  engine,
  doc,
  store,
  slotOf,
  selectedIds = [],
  ...actions
}: NodeHostsProps) {
  const [ids, setIds] = useState<readonly string[]>([]);
  const [zoom, setZoom] = useState(engine?.camera.state.zoom ?? 1);
  const [editingId, setEditingId] = useState<string | null>(null);

  const beginEdit = useCallback(
    (id: string) => {
      const node = store.getSnapshot(id);
      if (node === undefined || node.locked) return;
      if (!builtinNodeTypes().get(node.type).capabilities.editableText) return;
      setEditingId(id);
    },
    [store],
  );

  useEffect(() => {
    if (engine === null) return undefined;
    const offHosts = engine.on('hostsChanged', (next) => setIds([...next]));
    const offCamera = engine.on('cameraChanged', (state) => setZoom(state.zoom));
    return () => {
      offHosts();
      offCamera();
    };
  }, [engine]);

  // Enter on a single selection starts editing — the keyboard path to the same gesture as a
  // double-click (§5.5). Typing inside a field must never be hijacked, hence the target check.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (selectedIds.length !== 1) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      )
        return;
      const id = selectedIds[0];
      if (id === undefined) return;
      event.preventDefault();
      beginEdit(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, beginEdit]);

  // A node that stops being hosted (culled, deleted) must not stay "in edit" invisibly.
  useEffect(() => {
    if (editingId !== null && !ids.includes(editingId)) setEditingId(null);
  }, [ids, editingId]);

  const detailed = zoom >= DETAIL_ZOOM;
  const selected = new Set(selectedIds);

  return (
    <>
      {ids.map((id) => {
        const slot = slotOf(id);
        if (slot === undefined) return null;
        return (
          <HostedCard
            key={id}
            id={id}
            doc={doc}
            store={store}
            editing={editingId === id}
            onEndEdit={() => setEditingId(null)}
            slot={slot}
            detailed={detailed}
            selected={selected.has(id) && selected.size === 1}
            multiSelected={selected.has(id) && selected.size > 1}
            actions={{ ...actions, onBeginEdit: beginEdit }}
          />
        );
      })}
    </>
  );
}
