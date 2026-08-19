/**
 * Right-click on a relationship (P5 §6): change type, reverse, label, routing, delete.
 *
 * It is a plain positioned menu rather than the Radix dropdown primitive, because it opens at a
 * canvas point instead of hanging off a trigger element. Keyboard behaviour is kept: focus moves
 * into the menu, Escape closes it, and every entry is a real button.
 */

import { builtinEdgeTypes, type RoutingMode } from '@nexus/domain';
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';

import {
  deleteEdge,
  reverseEdge,
  setEdgeRouting,
  setEdgeType,
  type EdgeCommandContext,
  type EdgeCommandResult,
} from './edgeCommands.ts';
import { ROUTING_MODES } from './EdgeInspector.tsx';
import { useEdge } from './useEdge.ts';

export interface EdgeContextMenuProps {
  doc: Y.Doc;
  edgeId: string;
  context: EdgeCommandContext;
  /** Screen position of the click, in CSS px relative to the viewport. */
  at: { x: number; y: number };
  onClose: () => void;
  /** Opens the inspector on the label field ("Add label" in the menu). */
  onEditLabel?: ((id: string) => void) | undefined;
  onResult?: ((result: EdgeCommandResult) => void) | undefined;
}

export function EdgeContextMenu({
  doc,
  edgeId,
  context,
  at,
  onClose,
  onEditLabel,
  onResult,
}: EdgeContextMenuProps) {
  const edge = useEdge(doc, edgeId);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (edge === undefined) return null;

  const run = (result: EdgeCommandResult): void => {
    onResult?.(result);
    onClose();
  };

  const registry = builtinEdgeTypes();
  // The full taxonomy in a context menu is unusable; the entries the analyst reaches for are the
  // ones already on the board plus the current type (§6 "change type (submenu)").
  const frequent = registry
    .list()
    .filter((def) => def.category === registry.get(edge.type).category || def.type === edge.type)
    .slice(0, 8);

  return (
    <div
      ref={ref}
      className="nx-context-menu"
      role="menu"
      aria-label="Relationship actions"
      data-testid="edge-context-menu"
      style={{
        position: 'fixed',
        insetInlineStart: `${String(at.x)}px`,
        insetBlockStart: `${String(at.y)}px`,
      }}
    >
      <p className="nx-menu-heading">Relationship</p>
      {frequent.map((def) => (
        <button
          key={def.type}
          type="button"
          role="menuitem"
          className="nx-menu-item"
          aria-current={def.type === edge.type}
          onClick={() => run(setEdgeType(context, edge.id, def.type))}
        >
          {def.label}
        </button>
      ))}
      <hr />
      {ROUTING_MODES.map((mode: RoutingMode) => (
        <button
          key={mode}
          type="button"
          role="menuitem"
          className="nx-menu-item"
          onClick={() => run(setEdgeRouting(context, edge.id, mode))}
        >
          Route: {mode}
        </button>
      ))}
      <hr />
      <button
        type="button"
        role="menuitem"
        className="nx-menu-item"
        onClick={() => run(reverseEdge(context, edge.id))}
      >
        Reverse direction
      </button>
      <button
        type="button"
        role="menuitem"
        className="nx-menu-item"
        onClick={() => {
          onEditLabel?.(edge.id);
          onClose();
        }}
      >
        {edge.label === '' ? 'Add label' : 'Edit label'}
      </button>
      <button
        type="button"
        role="menuitem"
        className="nx-menu-item"
        data-kind="danger"
        onClick={() => run(deleteEdge(context, edge.id))}
      >
        Delete
      </button>
    </div>
  );
}
