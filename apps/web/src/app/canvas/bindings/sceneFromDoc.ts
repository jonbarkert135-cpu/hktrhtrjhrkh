/**
 * Document → engine binding (P3 §5.14). The engine never learns about Yjs: it receives a
 * `SceneSnapshot` on load and incremental `ScenePatch`es afterwards, computed with O(changed) work
 * from the observer summary. A full rebuild happens only on load and on snapshot restore.
 */

import type { EdgeView, NodeView, RGBA, ScenePatch, SceneSnapshot } from '@nexus/canvas-engine';
import {
  listEdges,
  listGroups,
  listNodes,
  type BoardChange,
  type BoardEdge,
  type BoardGroup,
  type BoardNode,
} from '@nexus/domain';
import type * as Y from 'yjs';

export const MAIN_LAYER_ID = 'l_main';

const rgba = (r: number, g: number, b: number, a = 1): RGBA => ({ r, g, b, a });

/** Accent per node type. Values are resolved from tokens by the theme layer in P4. */
const ACCENTS: Record<string, RGBA> = {
  note: rgba(0.98, 0.79, 0.29),
  website: rgba(0.36, 0.65, 0.98),
  person: rgba(0.62, 0.55, 0.98),
  file: rgba(0.45, 0.83, 0.66),
};

export function nodeToView(node: BoardNode, index: number): NodeView {
  return {
    id: node.id,
    kind: node.type,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    z: node.z === 0 ? index : node.z,
    layerId: MAIN_LAYER_ID,
    groupId: node.parentId,
    rotation: 0,
    locked: node.locked,
    hidden: node.hidden || node.status !== 'active',
    glyph: {
      accent: ACCENTS[node.type] ?? rgba(0.55, 0.6, 0.68),
      fill: rgba(0.11, 0.12, 0.15),
      icon: node.type,
      title: node.title.slice(0, 96),
      badgeCount: node.tags.length,
      thumbnailKey: null,
      status: 'none',
    },
    domKey: `${node.type}:${node.id}`,
    // Version is bumped on every write, which is exactly the paint-cache invalidation signal.
    visualVersion: node.version,
  };
}

export function edgeToView(edge: BoardEdge, index: number): EdgeView {
  return {
    id: edge.id,
    from: edge.source.nodeId,
    to: edge.target.nodeId,
    fromAnchor: { side: 'auto', t: edge.source.offset },
    toAnchor: { side: 'auto', t: edge.target.offset },
    routing: 'straight',
    style: {
      color: rgba(0.6, 0.63, 0.7, 0.85),
      width: 1.5,
      dash: null,
      arrowStart: false,
      arrowEnd: edge.directed,
      opacity: 1,
    },
    label: edge.label === '' ? null : edge.label,
    z: index,
    hidden: edge.hidden || edge.status !== 'active',
    visualVersion: edge.version,
  };
}

export function groupToView(group: BoardGroup) {
  return {
    id: group.id,
    title: group.label,
    color: rgba(0.35, 0.38, 0.45, 0.5),
    collapsed: group.collapsed,
    z: 0,
  };
}

/** Full snapshot — used on first load and after a snapshot restore. */
export function sceneFromDoc(doc: Y.Doc): SceneSnapshot {
  return {
    nodes: listNodes(doc).map(nodeToView),
    edges: listEdges(doc).map(edgeToView),
    groups: listGroups(doc).map(groupToView),
    layers: [{ id: MAIN_LAYER_ID, name: 'Main', visible: true, locked: false }],
  };
}

/**
 * Incremental patches for one observed change. Only the touched records are read from the document,
 * so a 200-node move costs 200 map reads, not a scene rebuild.
 */
export function patchesFromChange(doc: Y.Doc, change: BoardChange): ScenePatch[] {
  const patches: ScenePatch[] = [];
  if (change.nodes.upserted.length > 0) {
    const byId = new Map(listNodes(doc).map((node, index) => [node.id, { node, index }] as const));
    for (const id of change.nodes.upserted) {
      const found = byId.get(id);
      if (found !== undefined)
        patches.push({ op: 'upsert-node', node: nodeToView(found.node, found.index) });
    }
  }
  for (const id of change.nodes.removed) patches.push({ op: 'remove-node', id });

  if (change.edges.upserted.length > 0) {
    const byId = new Map(listEdges(doc).map((edge, index) => [edge.id, { edge, index }] as const));
    for (const id of change.edges.upserted) {
      const found = byId.get(id);
      if (found !== undefined)
        patches.push({ op: 'upsert-edge', edge: edgeToView(found.edge, found.index) });
    }
  }
  for (const id of change.edges.removed) patches.push({ op: 'remove-edge', id });

  if (change.groups.upserted.length > 0) {
    const byId = new Map(listGroups(doc).map((group) => [group.id, group] as const));
    for (const id of change.groups.upserted) {
      const group = byId.get(id);
      if (group !== undefined) patches.push({ op: 'upsert-group', group: groupToView(group) });
    }
  }
  for (const id of change.groups.removed) patches.push({ op: 'remove-group', id });

  return patches;
}
