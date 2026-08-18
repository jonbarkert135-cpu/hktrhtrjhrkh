/**
 * `defineEdgeType` fills the boring half of a relationship definition so a new type is a handful
 * of meaningful lines instead of eighteen fields, most of them repeated (07_EDGE_SYSTEM.md §3.1).
 *
 * The defaults are the ones the taxonomy uses most: a directed, solid, neutral, smart-routed,
 * user-asserted relationship between any two node types.
 */

import { ANY_NODE_TYPE, type EdgeTypeDefinition } from './types.ts';

export type EdgeTypeInput = Pick<
  EdgeTypeDefinition,
  'type' | 'label' | 'inverseLabel' | 'category'
> &
  Partial<Omit<EdgeTypeDefinition, 'type' | 'label' | 'inverseLabel' | 'category'>>;

const ANY_TO_ANY = [{ source: [ANY_NODE_TYPE], target: [ANY_NODE_TYPE] }] as const;

export function defineEdgeType(input: EdgeTypeInput): EdgeTypeDefinition {
  const directed = input.directed ?? true;
  return {
    type: input.type,
    label: input.label,
    inverseLabel: input.inverseLabel,
    category: input.category,
    directed,
    strokeToken: input.strokeToken ?? '--edge-neutral',
    dash: input.dash ?? 'solid',
    arrowSource: input.arrowSource ?? 'none',
    arrowTarget: input.arrowTarget ?? (directed ? 'arrow' : 'none'),
    defaultRouting: input.defaultRouting ?? 'smart',
    animated: input.animated ?? false,
    allowSelfLoop: input.allowSelfLoop ?? false,
    width: input.width ?? 1.5,
    inferred: input.inferred ?? false,
    allowed: input.allowed ?? ANY_TO_ANY,
    ...(input.suggest === undefined ? {} : { suggest: input.suggest }),
  };
}
