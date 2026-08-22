/**
 * The algorithm registry. A registry, not a `switch`: adding an algorithm is one entry here and
 * the picker, the worker protocol and the tests all pick it up (the same rule the node registry
 * follows in `06_NODE_SYSTEM.md` §1).
 */

import { cluster } from './algorithms/cluster.ts';
import { flow } from './algorithms/flow.ts';
import { force, DEFAULT_FORCE_ITERATIONS } from './algorithms/force.ts';
import { hierarchical } from './algorithms/hierarchical.ts';
import { radial } from './algorithms/radial.ts';
import type { LayoutAlgorithm } from './algorithms/shared.ts';
import { timeline } from './algorithms/timeline.ts';
import { tree } from './algorithms/tree.ts';
import { SPACING } from './spacing.ts';
import { LAYOUT_ALGORITHMS, type LayoutAlgorithmId, type LayoutOptions } from './types.ts';

/** Which options a given algorithm actually reads — the picker only shows these. */
export type LayoutOptionKey = 'direction' | 'iterations' | 'spacingX' | 'spacingY' | 'seed';

export interface LayoutAlgorithmDescriptor {
  readonly id: LayoutAlgorithmId;
  readonly label: string;
  /** One sentence an analyst can act on; shown under the picker and in the explanation. */
  readonly description: string;
  readonly options: readonly LayoutOptionKey[];
  readonly defaults: Required<Omit<LayoutOptions, 'preserveCentroid'>>;
  readonly run: LayoutAlgorithm;
}

const base = {
  seed: 1,
  spacingX: SPACING.nodeGap,
  spacingY: SPACING.rankGap,
  direction: 'down',
  iterations: 0,
} as const;

export const LAYOUT_CATALOGUE: Readonly<Record<LayoutAlgorithmId, LayoutAlgorithmDescriptor>> = {
  hierarchical: {
    id: 'hierarchical',
    label: 'Hierarchical',
    description: 'Layers by direction of causality: sources at the top, consequences below.',
    options: ['direction', 'spacingX', 'spacingY'],
    defaults: { ...base },
    run: hierarchical,
  },
  tree: {
    id: 'tree',
    label: 'Tree',
    description: 'A tidy tree per root: parents centred over their children, no crossings.',
    options: ['direction', 'spacingX', 'spacingY'],
    defaults: { ...base },
    run: tree,
  },
  radial: {
    id: 'radial',
    label: 'Radial',
    description: 'The best-connected node in the centre, its neighbourhood on rings around it.',
    options: ['spacingX', 'spacingY'],
    defaults: { ...base },
    run: radial,
  },
  force: {
    id: 'force',
    label: 'Force-directed',
    description: 'Lets structure emerge: tightly linked nodes attract, everything else repels.',
    options: ['iterations', 'spacingX', 'seed'],
    defaults: { ...base, iterations: DEFAULT_FORCE_ITERATIONS },
    run: force,
  },
  flow: {
    id: 'flow',
    label: 'Flow',
    description: 'Chains left to right, one band per disconnected chain.',
    options: ['direction', 'spacingX', 'spacingY'],
    defaults: { ...base, direction: 'right' },
    run: flow,
  },
  timeline: {
    id: 'timeline',
    label: 'Timeline',
    description: 'Chronology by observed date; undated nodes get their own lane, clearly apart.',
    options: ['spacingX', 'spacingY'],
    defaults: { ...base, direction: 'right' },
    run: timeline,
  },
  cluster: {
    id: 'cluster',
    label: 'Cluster',
    description: 'Groups (or connected components) packed into blocks, biggest first.',
    options: ['spacingX', 'spacingY'],
    defaults: { ...base },
    run: cluster,
  },
};

export const LAYOUT_DESCRIPTORS: readonly LayoutAlgorithmDescriptor[] = LAYOUT_ALGORITHMS.map(
  (id) => LAYOUT_CATALOGUE[id],
);
