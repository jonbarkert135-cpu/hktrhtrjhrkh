/**
 * React ⇄ overlay bridge (P4 §7). The engine decides *which* nodes deserve a DOM host and owns the
 * slot elements; React renders a card into each slot through a portal. Neither side learns about
 * the other's model: the engine emits ids, React reads those nodes from the store.
 */

import type { Engine } from '@nexus/canvas-engine';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { NodeCard, type NodeCardActions } from './NodeCard.tsx';
import type { NodeStore } from './nodeStore.ts';

/** Above this zoom a card shows descriptions and full badges (05_CANVAS_ENGINE.md §5, L3). */
export const DETAIL_ZOOM = 1.6;

export interface NodeHostsProps extends NodeCardActions {
  engine: Engine | null;
  store: NodeStore;
  /** Slot lookup, supplied by the canvas hook that owns the overlay. */
  slotOf: (id: string) => HTMLElement | undefined;
  selectedIds?: readonly string[];
}

function HostedCard({
  id,
  store,
  slot,
  detailed,
  selected,
  multiSelected,
  actions,
}: {
  id: string;
  store: NodeStore;
  slot: HTMLElement;
  detailed: boolean;
  selected: boolean;
  multiSelected: boolean;
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
      {...actions}
    />,
    slot,
  );
}

export function NodeHosts({
  engine,
  store,
  slotOf,
  selectedIds = [],
  ...actions
}: NodeHostsProps) {
  const [ids, setIds] = useState<readonly string[]>([]);
  const [zoom, setZoom] = useState(engine?.camera.state.zoom ?? 1);

  useEffect(() => {
    if (engine === null) return undefined;
    const offHosts = engine.on('hostsChanged', (next) => setIds([...next]));
    const offCamera = engine.on('cameraChanged', (state) => setZoom(state.zoom));
    return () => {
      offHosts();
      offCamera();
    };
  }, [engine]);

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
            store={store}
            slot={slot}
            detailed={detailed}
            selected={selected.has(id) && selected.size === 1}
            multiSelected={selected.has(id) && selected.size > 1}
            actions={actions}
          />
        );
      })}
    </>
  );
}
