/**
 * `@nexus/layout` — the pure, deterministic auto-layout engine (P14a).
 *
 * Zero internal dependencies by design: layout is geometry over a graph, so it must be callable
 * from the web app, from a worker, from the bench and from a test without pulling in Yjs, React or
 * the canvas engine. See `docs/adr/ADR-006-layout-package.md`.
 */

export * from './types.ts';
export { SPACING, snap } from './spacing.ts';
export { createRng, hashString, DEFAULT_SEED, type Rng } from './rng.ts';
export {
  buildAdjacency,
  components,
  acyclic,
  rankNodes,
  spanningForest,
  type AdjacencyView,
} from './graph.ts';
export { separate, countOverlaps, type Placement } from './overlap.ts';
export {
  LAYOUT_CATALOGUE,
  LAYOUT_DESCRIPTORS,
  type LayoutAlgorithmDescriptor,
  type LayoutOptionKey,
} from './catalogue.ts';
export { applyScope, type LayoutScope } from './scope.ts';
export {
  runLayout,
  proposeLayout,
  toLayoutDiff,
  explainLayout,
  type RunLayoutRequest,
} from './runLayout.ts';
