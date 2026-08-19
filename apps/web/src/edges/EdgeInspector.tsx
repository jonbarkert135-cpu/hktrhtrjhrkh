/**
 * The relationship inspector (P5 §5.11). Same panel geometry as the node inspector, different
 * content: what the relationship means, which way it reads, how it is drawn, and where it came
 * from — plus the two structural actions, reverse and delete.
 *
 * Every control writes through `edgeCommands`, so one interaction is one transaction and one undo
 * step, and a refused command explains itself instead of silently doing nothing.
 */

import { builtinEdgeTypes, readingLabel, type BoardEdge, type RoutingMode } from '@nexus/domain';
import { Button } from '@nexus/ui';
import { useState } from 'react';
import type * as Y from 'yjs';

import {
  deleteEdge,
  reverseEdge,
  setEdgeConfidence,
  setEdgeDirected,
  setEdgeLabel,
  setEdgeRouting,
  setEdgeType,
  type EdgeCommandContext,
  type EdgeCommandResult,
} from './edgeCommands.ts';
import { useEdge } from './useEdge.ts';

export const ROUTING_MODES: readonly RoutingMode[] = ['curved', 'orthogonal', 'straight', 'smart'];
const CONFIDENCES: readonly BoardEdge['confidence'][] = ['high', 'medium', 'low', 'unknown'];

export interface EdgeInspectorProps {
  doc: Y.Doc;
  edgeId: string;
  context: EdgeCommandContext;
  /** Titles of the endpoints, resolved by the board (the panel does not read the node list). */
  endpoints?: { source: string; target: string } | undefined;
  width?: number;
  onClose?: (() => void) | undefined;
  /** Called after the relationship is deleted, so the board can clear the selection. */
  onDeleted?: ((id: string) => void) | undefined;
}

export function EdgeInspector({
  doc,
  edgeId,
  context,
  endpoints,
  width = 360,
  onClose,
  onDeleted,
}: EdgeInspectorProps) {
  const edge = useEdge(doc, edgeId);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState<string | null>(null);

  const report = (result: EdgeCommandResult): void => setNotice(result.message);
  const panelStyle = { inlineSize: `${String(width)}px` };

  if (edge === undefined) {
    return (
      <aside
        className="nx-inspector"
        style={panelStyle}
        aria-label="Relationship"
        data-testid="edge-inspector"
      >
        <header className="nx-inspector-head">
          <h2>Relationship deleted</h2>
        </header>
        <p className="nx-inspector-empty">
          This relationship is gone. Press ⌘Z to bring it back, or select another one.
        </p>
      </aside>
    );
  }

  const registry = builtinEdgeTypes();
  const definition = registry.get(edge.type);
  const label = draftLabel ?? edge.label;
  const sourceTitle = endpoints?.source ?? edge.source.nodeId;
  const targetTitle = endpoints?.target ?? edge.target.nodeId;

  return (
    <aside
      className="nx-inspector"
      style={panelStyle}
      aria-label="Relationship"
      data-testid="edge-inspector"
    >
      <header className="nx-inspector-head">
        <h2>Relationship</h2>
        {onClose === undefined ? null : (
          <button type="button" onClick={onClose} aria-label="Close details">
            ×
          </button>
        )}
      </header>

      <p className="nx-card-meta" data-testid="edge-reading">
        {sourceTitle} {readingLabel(definition)} {targetTitle}
      </p>
      {notice === null ? null : (
        <p className="nx-field-error" role="status">
          {notice}
        </p>
      )}

      <section className="nx-inspector-section">
        <h3>Type</h3>
        <label htmlFor="edge-type">Relationship type</label>
        <select
          id="edge-type"
          value={edge.type}
          onChange={(event) => report(setEdgeType(context, edge.id, event.target.value))}
        >
          {registry
            .list()
            .slice()
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((def) => (
              <option key={def.type} value={def.type}>
                {def.label} · {def.category}
              </option>
            ))}
        </select>
        <p className="nx-card-meta">
          Reads backwards as “{targetTitle} {readingLabel(definition, true)} {sourceTitle}”.
        </p>

        <label htmlFor="edge-directed">
          <input
            id="edge-directed"
            type="checkbox"
            checked={edge.directed}
            onChange={(event) => report(setEdgeDirected(context, edge.id, event.target.checked))}
          />
          Directed
        </label>
      </section>

      <section className="nx-inspector-section">
        <h3>Appearance</h3>
        <label htmlFor="edge-routing">Routing</label>
        <select
          id="edge-routing"
          value={edge.style.routing ?? definition.defaultRouting}
          onChange={(event) =>
            report(setEdgeRouting(context, edge.id, event.target.value as RoutingMode))
          }
        >
          {ROUTING_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>

        <label htmlFor="edge-label">Label</label>
        <input
          id="edge-label"
          value={label}
          onChange={(event) => setDraftLabel(event.target.value)}
          onBlur={() => {
            if (draftLabel === null) return;
            report(setEdgeLabel(context, edge.id, draftLabel));
            setDraftLabel(null);
          }}
        />

        <label htmlFor="edge-confidence">Confidence</label>
        <select
          id="edge-confidence"
          value={edge.confidence}
          onChange={(event) =>
            report(
              setEdgeConfidence(context, edge.id, event.target.value as BoardEdge['confidence']),
            )
          }
        >
          {CONFIDENCES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </section>

      <section className="nx-inspector-section">
        <h3>Provenance</h3>
        <p className="nx-card-meta" data-testid="edge-provenance">
          {String(edge.provenance.kind)}
          {edge.provenance.tool === null || edge.provenance.tool === undefined
            ? ''
            : ` · ${String(edge.provenance.tool)}`}{' '}
          · created {edge.createdAt}
        </p>
      </section>

      <section className="nx-inspector-section">
        <h3>Actions</h3>
        <Button variant="secondary" onClick={() => report(reverseEdge(context, edge.id))}>
          Reverse direction
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const result = deleteEdge(context, edge.id);
            report(result);
            if (result.ok) onDeleted?.(edge.id);
          }}
        >
          Delete relationship
        </Button>
      </section>
    </aside>
  );
}
