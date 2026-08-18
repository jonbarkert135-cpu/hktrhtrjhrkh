/**
 * The inspector panel (P4 §5.6, §6). Right side, 360 px, resizable 320–560 px, collapsible. It is
 * rendered generically from the registry's field descriptors plus the four shared sections every
 * type has: identity, content/attributes, provenance and connections.
 *
 * Editing writes through the domain lifecycle helpers, so every change is one transaction and one
 * undo step — the panel has no private copy of the node.
 */

import {
  builtinNodeTypes,
  listEdges,
  listNodes,
  setNodeTags,
  updateNode,
  updateNodeData,
  type BoardNode,
} from '@nexus/domain';
import { useCallback, useState, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';

import { cardStateOf } from '../cardState.ts';
import { NodeIcon } from '../icons.tsx';
import type { NodeStore } from '../nodeStore.ts';
import { FieldControl, readPath } from './fields.tsx';
import { TagEditor } from './TagEditor.tsx';

export const INSPECTOR_MIN_WIDTH = 320;
export const INSPECTOR_MAX_WIDTH = 560;
export const INSPECTOR_DEFAULT_WIDTH = 360;

export interface InspectorProps {
  doc: Y.Doc;
  store: NodeStore;
  selectedIds: readonly string[];
  width?: number;
  onWidthChange?: ((width: number) => void) | undefined;
  onClose?: (() => void) | undefined;
  now?: () => string;
}

interface Connection {
  edgeId: string;
  direction: 'in' | 'out';
  otherId: string;
  otherTitle: string;
  label: string;
}

function connectionsOf(doc: Y.Doc, nodeId: string): Connection[] {
  const titles = new Map(listNodes(doc).map((node) => [node.id, node.title] as const));
  const out: Connection[] = [];
  for (const edge of listEdges(doc)) {
    if (edge.source.nodeId === nodeId) {
      out.push({
        edgeId: edge.id,
        direction: 'out',
        otherId: edge.target.nodeId,
        otherTitle: titles.get(edge.target.nodeId) ?? 'Deleted node',
        label: edge.label,
      });
    } else if (edge.target.nodeId === nodeId) {
      out.push({
        edgeId: edge.id,
        direction: 'in',
        otherId: edge.source.nodeId,
        otherTitle: titles.get(edge.source.nodeId) ?? 'Deleted node',
        label: edge.label,
      });
    }
  }
  return out;
}

function useNode(store: NodeStore, id: string | undefined): BoardNode | undefined {
  return useSyncExternalStore(
    (listener) => (id === undefined ? () => undefined : store.subscribe(id, listener)),
    () => (id === undefined ? undefined : store.getSnapshot(id)),
    () => (id === undefined ? undefined : store.getSnapshot(id)),
  );
}

export function Inspector({
  doc,
  store,
  selectedIds,
  width = INSPECTOR_DEFAULT_WIDTH,
  onWidthChange,
  onClose,
  now = () => new Date().toISOString(),
}: InspectorProps) {
  const single = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const node = useNode(store, single);
  const [issues, setIssues] = useState<Record<string, string>>({});

  // Recomputed per render on purpose: the panel renders when its node changes, not per frame.
  const boardTags = listNodes(doc).map((entry) => entry.tags);

  const commitTags = useCallback(
    (id: string, tags: string[]) => {
      const result = setNodeTags(doc, id, tags, { now: now() });
      return { rejected: result.rejected };
    },
    [doc, now],
  );

  const clampWidth = (value: number): number =>
    Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, value));

  const panelStyle = { inlineSize: `${String(clampWidth(width))}px` };

  if (selectedIds.length === 0) {
    return (
      <aside className="nx-inspector" style={panelStyle} aria-label="Details" data-testid="inspector">
        <header className="nx-inspector-head">
          <h2>Board</h2>
        </header>
        <p className="nx-inspector-empty">
          Select a node to see its details. Shift-click or drag a box to select several and edit what
          they share.
        </p>
        <p className="nx-card-meta">
          {String(listNodes(doc).length)} nodes · {String(listEdges(doc).length)} connections
        </p>
      </aside>
    );
  }

  if (selectedIds.length > 1) {
    // Multi-selection: only the fields every selected node has in common (P4 §6).
    const nodes = selectedIds
      .map((id) => store.getSnapshot(id))
      .filter((entry): entry is BoardNode => entry !== undefined);
    const shared = nodes.reduce<string[]>(
      (acc, entry) => acc.filter((tag) => entry.tags.includes(tag)),
      nodes[0]?.tags ?? [],
    );
    return (
      <aside className="nx-inspector" style={panelStyle} aria-label="Details" data-testid="inspector">
        <header className="nx-inspector-head">
          <h2>{String(selectedIds.length)} nodes selected</h2>
          {onClose === undefined ? null : (
            <button type="button" onClick={onClose} aria-label="Close details">
              ×
            </button>
          )}
        </header>
        <section className="nx-inspector-section">
          <h3>Shared tags</h3>
          <TagEditor
            tags={shared}
            boardTags={boardTags}
            onChange={(tags) => {
              let rejected: Array<{ message: string }> = [];
              for (const entry of nodes) {
                const added = tags.filter((tag) => !shared.includes(tag));
                const removed = shared.filter((tag) => !tags.includes(tag));
                const next = [...entry.tags.filter((tag) => !removed.includes(tag)), ...added];
                rejected = commitTags(entry.id, next).rejected;
              }
              return { rejected };
            }}
          />
        </section>
      </aside>
    );
  }

  if (node === undefined) {
    return (
      <aside className="nx-inspector" style={panelStyle} aria-label="Details" data-testid="inspector">
        <header className="nx-inspector-head">
          <h2>Node deleted</h2>
        </header>
        <p className="nx-inspector-empty">
          This node is gone. Press ⌘Z to bring it back, or select another node.
        </p>
      </aside>
    );
  }

  const def = builtinNodeTypes().get(node.type);
  const state = cardStateOf(node);
  const connections = connectionsOf(doc, node.id);
  const sections: Array<{ id: string; title: string }> = [
    { id: 'identity', title: 'Identity' },
    { id: 'content', title: 'Content' },
    { id: 'attributes', title: 'Attributes' },
  ];

  const commitField = (key: string, value: unknown): void => {
    const validation = { ...issues };
    if (key.startsWith('data.')) {
      updateNodeData(doc, node.id, { [key.slice('data.'.length)]: value }, { now: now() });
    } else if (key === 'title') {
      updateNode(doc, node.id, { title: String(value) }, { origin: 'local:edit', now: now() });
    }
    const updated = store.getSnapshot(node.id);
    delete validation[key];
    if (updated !== undefined) {
      for (const issue of def.validate?.(updated) ?? []) {
        if (issue.severity === 'error' || issue.field === key) validation[issue.field] = issue.message;
      }
    }
    setIssues(validation);
  };

  return (
    <aside className="nx-inspector" style={panelStyle} aria-label="Details" data-testid="inspector">
      <header className="nx-inspector-head">
        <span style={{ color: `var(${def.glyph.colorToken})` }}>
          <NodeIcon icon={def.glyph.icon} label={def.label} />
        </span>
        <h2>{node.title === '' ? `Untitled ${def.label.toLowerCase()}` : node.title}</h2>
        <span className="nx-chip" data-kind="state">
          {state}
        </span>
        {onWidthChange === undefined ? null : (
          <input
            className="nx-inspector-resize"
            type="range"
            min={INSPECTOR_MIN_WIDTH}
            max={INSPECTOR_MAX_WIDTH}
            value={clampWidth(width)}
            aria-label="Panel width"
            onChange={(event) => onWidthChange(clampWidth(Number(event.target.value)))}
          />
        )}
        {onClose === undefined ? null : (
          <button type="button" onClick={onClose} aria-label="Close details">
            ×
          </button>
        )}
      </header>

      <section className="nx-inspector-section">
        <FieldControl
          field={{ key: 'title', label: 'Title', control: 'text', section: 'identity' }}
          value={node.title}
          {...(issues['title'] === undefined ? {} : { error: issues['title'] })}
          onCommit={(value) => commitField('title', value)}
        />
        <TagEditor
          tags={node.tags}
          boardTags={boardTags}
          disabled={node.locked}
          onChange={(tags) => commitTags(node.id, tags)}
        />
      </section>

      {sections.map((section) => {
        const fields = def.inspector.filter((field) => field.section === section.id);
        if (fields.length === 0) return null;
        return (
          <section className="nx-inspector-section" key={section.id}>
            <h3>{section.title}</h3>
            {fields.map((field) => (
              <FieldControl
                key={field.key}
                field={field}
                value={readPath(node as unknown as Record<string, unknown>, field.key)}
                disabled={node.locked}
                {...(issues[field.key] === undefined ? {} : { error: issues[field.key] })}
                onCommit={(value) => commitField(field.key, value)}
              />
            ))}
          </section>
        );
      })}

      <section className="nx-inspector-section" data-testid="inspector-connections">
        <h3>Connections</h3>
        {connections.length === 0 ? (
          <p className="nx-card-meta">No connections yet. Press E with a node selected to draw one.</p>
        ) : (
          <ul className="nx-inspector-list">
            {connections.map((connection) => (
              <li key={connection.edgeId}>
                <span className="nx-chip">{connection.direction === 'in' ? 'in' : 'out'}</span>{' '}
                {connection.otherTitle}
                {connection.label === '' ? '' : ` · ${connection.label}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="nx-inspector-section" data-testid="inspector-provenance">
        <h3>Provenance</h3>
        <dl className="nx-inspector-meta">
          <dt>Source</dt>
          <dd>{node.provenance.kind}</dd>
          <dt>From</dt>
          <dd>{node.provenance.source ?? '—'}</dd>
          <dt>Tool</dt>
          <dd>
            {node.provenance.tool ?? '—'}
            {node.provenance.runId === null ? null : (
              // The run view arrives in P9; the reference is shown now so the trail is never lost.
              <span className="nx-card-meta"> · run {node.provenance.runId}</span>
            )}
          </dd>
          <dt>Observed</dt>
          <dd>{node.provenance.observedAt ?? '—'}</dd>
          <dt>Confidence</dt>
          <dd>{node.confidence}</dd>
          <dt>Id</dt>
          <dd>
            <code>{node.id}</code>
          </dd>
        </dl>
      </section>
    </aside>
  );
}
