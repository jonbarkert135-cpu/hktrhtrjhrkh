/**
 * Deterministic board factory shared by engine, bench and e2e fixtures (20_ROADMAP.md P2 §2).
 *
 * The shape matches `SceneSnapshot` from `@nexus/canvas-engine` **structurally only**: domain must
 * not depend on the canvas engine (dependency-cruiser forbids the edge), so the types are declared
 * here and consumers assign the result to their own `SceneSnapshot` typed variable.
 */

export interface FactoryRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FactoryNode {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  layerId: string;
  groupId: string | null;
  rotation: 0;
  locked: boolean;
  hidden: boolean;
  glyph: {
    accent: FactoryRGBA;
    fill: FactoryRGBA;
    icon: string;
    title: string;
    badgeCount: number;
    thumbnailKey: string | null;
    status: 'none' | 'running' | 'error' | 'stale';
  };
  domKey: string;
  visualVersion: number;
}

export interface FactoryEdge {
  id: string;
  from: string;
  to: string;
  fromAnchor: { side: 'auto'; t: number };
  toAnchor: { side: 'auto'; t: number };
  routing: 'straight';
  style: {
    color: FactoryRGBA;
    width: number;
    dash: readonly number[] | null;
    arrowStart: boolean;
    arrowEnd: boolean;
    opacity: number;
  };
  label: string | null;
  z: number;
  hidden: boolean;
  visualVersion: number;
}

export interface FactoryLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface FactoryGroup {
  id: string;
  title: string;
  color: FactoryRGBA;
  collapsed: boolean;
  z: number;
}

export interface FactoryBoard {
  nodes: FactoryNode[];
  edges: FactoryEdge[];
  groups: FactoryGroup[];
  layers: FactoryLayer[];
}

export interface MakeBoardOptions {
  nodes: number;
  edges: number;
  /** Same seed ⇒ byte-identical board. */
  seed?: number;
}

const KINDS = ['note', 'website', 'image', 'file', 'person'] as const;
export const FACTORY_LAYER_ID = 'l_main';

/** mulberry32 — 32 bits of state, uniform enough for fixtures, no dependency. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = (r: number, g: number, b: number, a = 1): FactoryRGBA => ({ r, g, b, a });

/**
 * A board of `nodes` cards laid out on a jittered grid with `edges` random connections. Ids are
 * zero-padded and stable (`n_000001`), so snapshots are diffable.
 */
export function makeBoard(options: MakeBoardOptions): FactoryBoard {
  const { nodes: nodeCount, edges: edgeCount, seed = 1 } = options;
  if (!Number.isInteger(nodeCount) || nodeCount < 0) throw new RangeError('nodes must be ≥ 0');
  if (!Number.isInteger(edgeCount) || edgeCount < 0) throw new RangeError('edges must be ≥ 0');

  const rand = prng(seed);
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodeCount)));
  const nodes: FactoryNode[] = [];

  for (let i = 0; i < nodeCount; i += 1) {
    const kind = KINDS[i % KINDS.length] ?? 'note';
    const col = i % columns;
    const row = Math.floor(i / columns);
    const w = 200 + Math.floor(rand() * 160);
    const h = 120 + Math.floor(rand() * 100);
    nodes.push({
      id: `n_${String(i + 1).padStart(6, '0')}`,
      kind,
      x: col * 420 + Math.floor(rand() * 60),
      y: row * 300 + Math.floor(rand() * 40),
      w,
      h,
      z: i,
      layerId: FACTORY_LAYER_ID,
      groupId: null,
      rotation: 0,
      locked: false,
      hidden: false,
      glyph: {
        accent: rgba(0.2, 0.5, 0.9),
        fill: rgba(0.1, 0.1, 0.12),
        icon: kind,
        title: `${kind} ${i + 1}`,
        badgeCount: 0,
        thumbnailKey: null,
        status: 'none',
      },
      domKey: `${kind}:${i + 1}`,
      visualVersion: 1,
    });
  }

  const edges: FactoryEdge[] = [];
  if (nodeCount >= 2) {
    for (let i = 0; i < edgeCount; i += 1) {
      const a = Math.floor(rand() * nodeCount);
      let b = Math.floor(rand() * nodeCount);
      if (b === a) b = (a + 1) % nodeCount;
      const from = nodes[a];
      const to = nodes[b];
      if (!from || !to) continue;
      edges.push({
        id: `e_${String(i + 1).padStart(6, '0')}`,
        from: from.id,
        to: to.id,
        fromAnchor: { side: 'auto', t: 0.5 },
        toAnchor: { side: 'auto', t: 0.5 },
        routing: 'straight',
        style: {
          color: rgba(0.6, 0.6, 0.65, 0.8),
          width: 1.5,
          dash: null,
          arrowStart: false,
          arrowEnd: true,
          opacity: 1,
        },
        label: null,
        z: i,
        hidden: false,
        visualVersion: 1,
      });
    }
  }

  return {
    nodes,
    edges,
    groups: [],
    layers: [{ id: FACTORY_LAYER_ID, name: 'Main', visible: true, locked: false }],
  };
}
