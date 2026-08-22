/**
 * §32 — the non-canvas representations. One component, five projections, zero duplicated state:
 * it re-reads the same nodes/edges the canvas renders. Selecting a row selects the node, so a
 * mode switch never loses the investigator's place.
 */

import type { BoardEdge, BoardNode } from '@nexus/domain';
import { runLayout } from '@nexus/layout';
import { useMemo } from 'react';

import {
  graphProjection,
  mapPoints,
  projectPoint,
  tableRows,
  timelineBuckets,
  type ViewMode,
} from './projections.ts';

export interface ViewPanelProps {
  mode: Exclude<ViewMode, 'canvas'>;
  nodes: readonly BoardNode[];
  edges: readonly BoardEdge[];
  onSelect?: ((nodeId: string) => void) | undefined;
}

const GRAPH_BOX = { width: 960, height: 540 };

export function ViewPanel({ mode, nodes, edges, onSelect }: ViewPanelProps) {
  const rows = useMemo(() => tableRows(nodes, edges), [nodes, edges]);

  if (mode === 'table') {
    return (
      <div className="nx-view" data-testid="view-table">
        <table className="nx-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Type</th>
              <th scope="col">Links</th>
              <th scope="col">Confidence</th>
              <th scope="col">Tags</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} onClick={() => onSelect?.(row.id)}>
                <th scope="row">{row.title}</th>
                <td>{row.type}</td>
                <td>{String(row.degree)}</td>
                <td>{row.confidence}</td>
                <td>{row.tags}</td>
                <td>{row.updatedAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (mode === 'list') {
    return (
      <ul className="nx-view nx-view-list" data-testid="view-list">
        {rows.map((row) => (
          <li key={row.id}>
            <button type="button" className="nx-menu-item" onClick={() => onSelect?.(row.id)}>
              <strong>{row.title}</strong>
              <span className="nx-muted">
                {' '}
                {row.type} · {String(row.degree)} links
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  if (mode === 'timeline') {
    const buckets = timelineBuckets(nodes);
    return (
      <div className="nx-view" data-testid="view-timeline">
        {buckets.map((bucket) => (
          <section key={bucket.day} className="nx-timeline-day">
            <h3>{bucket.day}</h3>
            <ul>
              {bucket.nodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className="nx-menu-item"
                    onClick={() => onSelect?.(node.id)}
                  >
                    {node.title || node.id}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  if (mode === 'map') {
    const { points, unplaced } = mapPoints(nodes);
    return (
      <div className="nx-view" data-testid="view-map">
        <div className="nx-map">
          {points.map((point) => {
            const { x, y } = projectPoint(point);
            return (
              <button
                key={point.id}
                type="button"
                className="nx-map-pin"
                style={{ left: `${String(x * 100)}%`, top: `${String(y * 100)}%` }}
                title={`${point.title} (${String(point.lat)}, ${String(point.lon)})`}
                onClick={() => onSelect?.(point.id)}
              >
                <span className="nx-visually-hidden">{point.title}</span>
              </button>
            );
          })}
        </div>
        <p className="nx-muted">
          {String(points.length)} placed · {String(unplaced)} without coordinates
        </p>
      </div>
    );
  }

  return <GraphView nodes={nodes} edges={edges} onSelect={onSelect} />;
}

function GraphView({ nodes, edges, onSelect }: Omit<ViewPanelProps, 'mode'>) {
  const projection = useMemo(() => graphProjection(nodes, edges), [nodes, edges]);
  const positions = useMemo(() => {
    const result = runLayout(
      {
        nodes: projection.nodes.map((node, index) => ({
          id: node.id,
          x: (index % 8) * 200,
          y: Math.floor(index / 8) * 160,
          w: 160,
          h: 80,
        })),
        edges: projection.links,
      },
      { algorithm: 'force' },
    );
    return new Map(result.positions.map((position) => [position.id, position]));
  }, [projection]);

  const boxes = projection.nodes.map((node) => ({
    ...node,
    ...(positions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const minX = Math.min(0, ...boxes.map((box) => box.x));
  const minY = Math.min(0, ...boxes.map((box) => box.y));
  const maxX = Math.max(GRAPH_BOX.width, ...boxes.map((box) => box.x));
  const maxY = Math.max(GRAPH_BOX.height, ...boxes.map((box) => box.y));
  // The viewBox scales to fit the layout, so label text has to scale with it to stay readable.
  const scale = (maxX - minX + 200) / GRAPH_BOX.width;
  const at = (id: string) => boxes.find((box) => box.id === id) ?? { x: 0, y: 0 };

  return (
    <div className="nx-view" data-testid="view-graph">
      <svg
        role="img"
        aria-label="Connection graph"
        viewBox={`${String(minX - 40)} ${String(minY - 40)} ${String(maxX - minX + 200)} ${String(maxY - minY + 160)}`}
      >
        {projection.links.map((link) => (
          <line
            key={link.id}
            x1={at(link.source).x + 80}
            y1={at(link.source).y + 40}
            x2={at(link.target).x + 80}
            y2={at(link.target).y + 40}
            stroke="currentColor"
            strokeOpacity={0.35}
          />
        ))}
        {boxes.map((box) => (
          <g key={box.id} onClick={() => onSelect?.(box.id)}>
            <circle
              cx={box.x + 80}
              cy={box.y + 40}
              r={(12 + Math.min(box.degree, 8) * 2) * scale}
            />
            <text x={box.x + 80} y={box.y + 72} textAnchor="middle" fontSize={13 * scale}>
              {box.title}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
