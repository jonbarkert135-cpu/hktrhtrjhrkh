/**
 * §32 — representation layer. Every view mode is a pure projection of the same nodes and edges;
 * no data is copied into a view-specific store, so switching a mode can never diverge from the
 * document (N2). Canvas keeps its own renderer; the other modes are plain lists built here.
 */

import type { BoardEdge, BoardNode } from '@nexus/domain';

export const VIEW_MODES = ['canvas', 'graph', 'timeline', 'table', 'map', 'list'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const VIEW_LABELS: Record<ViewMode, string> = {
  canvas: 'Canvas',
  graph: 'Graph',
  timeline: 'Timeline',
  table: 'Table',
  map: 'Map',
  list: 'List',
};

export function isViewMode(value: string): value is ViewMode {
  return (VIEW_MODES as readonly string[]).includes(value);
}

const visible = (node: BoardNode): boolean => node.status === 'active' && !node.hidden;

export interface TableRow {
  id: string;
  title: string;
  type: string;
  confidence: string;
  tags: string;
  source: string;
  updatedAt: string;
  degree: number;
}

export function tableRows(nodes: readonly BoardNode[], edges: readonly BoardEdge[]): TableRow[] {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source.nodeId, (degree.get(edge.source.nodeId) ?? 0) + 1);
    degree.set(edge.target.nodeId, (degree.get(edge.target.nodeId) ?? 0) + 1);
  }
  return nodes
    .filter(visible)
    .map((node) => ({
      id: node.id,
      title: node.title || node.id,
      type: node.type,
      confidence: node.confidence,
      tags: node.tags.join(', '),
      source: node.provenance.source ?? '',
      updatedAt: node.updatedAt,
      degree: degree.get(node.id) ?? 0,
    }))
    .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title));
}

export interface TimelineBucket {
  /** `YYYY-MM-DD` of the observation, or `undated`. */
  day: string;
  nodes: BoardNode[];
}

/** Observation time first, creation time as the fallback: an investigation is dated by evidence. */
function dayOf(node: BoardNode): string {
  const iso = node.provenance.observedAt ?? node.createdAt;
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'undated';
}

export function timelineBuckets(nodes: readonly BoardNode[]): TimelineBucket[] {
  const byDay = new Map<string, BoardNode[]>();
  for (const node of nodes.filter(visible)) {
    const day = dayOf(node);
    const bucket = byDay.get(day);
    if (bucket === undefined) byDay.set(day, [node]);
    else bucket.push(node);
  }
  return [...byDay.entries()]
    .map(([day, bucketNodes]) => ({ day, nodes: bucketNodes }))
    .sort((a, b) => {
      if (a.day === 'undated') return 1;
      if (b.day === 'undated') return -1;
      return a.day.localeCompare(b.day);
    });
}

export interface MapPoint {
  id: string;
  title: string;
  lat: number;
  lon: number;
}

function coordinate(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Only nodes that actually carry coordinates are mappable; the rest are reported as unplaced. */
export function mapPoints(nodes: readonly BoardNode[]): { points: MapPoint[]; unplaced: number } {
  const points: MapPoint[] = [];
  let unplaced = 0;
  for (const node of nodes.filter(visible)) {
    const lat = coordinate(node.data['lat'] ?? node.data['latitude']);
    const lon = coordinate(node.data['lon'] ?? node.data['lng'] ?? node.data['longitude']);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      unplaced += 1;
      continue;
    }
    points.push({ id: node.id, title: node.title || node.id, lat, lon });
  }
  points.sort((a, b) => a.id.localeCompare(b.id));
  return { points, unplaced };
}

/** Equirectangular projection into a 0..1 box — enough to place pins without a tile provider. */
export function projectPoint(point: MapPoint): { x: number; y: number } {
  return { x: (point.lon + 180) / 360, y: (90 - point.lat) / 180 };
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface GraphProjection {
  nodes: { id: string; title: string; type: string; degree: number }[];
  links: GraphLink[];
}

/** Graph mode drops geometry entirely: it is the connectivity view, laid out by the host. */
export function graphProjection(
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
): GraphProjection {
  const rows = tableRows(nodes, edges);
  const ids = new Set(rows.map((row) => row.id));
  return {
    nodes: rows.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      degree: row.degree,
    })),
    links: edges
      .filter(
        (edge) =>
          edge.status === 'active' &&
          !edge.hidden &&
          ids.has(edge.source.nodeId) &&
          ids.has(edge.target.nodeId),
      )
      .map((edge) => ({
        id: edge.id,
        source: edge.source.nodeId,
        target: edge.target.nodeId,
        label: edge.label || edge.type,
      })),
  };
}
