/**
 * The 22 built-in relationship types (07_EDGE_SYSTEM.md §3.2) plus `related_to` (the schema
 * default) and the `custom` fallback.
 * `registerEdgeBuiltins()` is the only place that knows the full list; everything else asks the
 * registry. It is idempotent so tests and hot reloads can call it freely.
 *
 * Endpoint rules name node type ids from 06_NODE_SYSTEM.md §4. Several of those types land in
 * later phases (`domain`, `ip`, `organization`, `username`, `email`, `group`, `location`,
 * `hypothesis`, `evidence`, `timeline-event`, `tool-result`); listing them now costs nothing —
 * rules are data, and an unmatched pair is a warning, never a rejection (§3.4).
 */

import { defineEdgeType } from './define.ts';
import { edgeTypes } from './registry.ts';
import type { EdgeTypeRegistry } from './registry.ts';
import { ANY_NODE_TYPE, CUSTOM_EDGE_TYPE, type EdgeTypeDefinition } from './types.ts';

const ANY = ANY_NODE_TYPE;
const ACTORS = ['person', 'organization'];
const IDENTIFIERS = ['username', 'email'];
const EVIDENCE = ['evidence', 'text', 'tool-result', 'file', 'website'];

export const builtinEdgeTypeDefinitions: readonly EdgeTypeDefinition[] = [
  defineEdgeType({
    type: 'references',
    label: 'references',
    inverseLabel: 'referenced by',
    category: 'structural',
    allowSelfLoop: true,
  }),
  defineEdgeType({
    // Not in the 07 §3.2 table, but it is the schema default of `makeEdge` (08 §2.2.3): an
    // untyped association an analyst drew before deciding what it means.
    type: 'related_to',
    label: 'related to',
    inverseLabel: 'related to',
    category: 'structural',
    directed: false,
    defaultRouting: 'curved',
    allowSelfLoop: true,
  }),
  defineEdgeType({
    type: 'derived_from',
    label: 'derived from',
    inverseLabel: 'produced',
    category: 'structural',
    strokeToken: '--edge-derived',
    dash: 'dashed',
    animated: true,
    inferred: true,
    defaultRouting: 'curved',
  }),
  defineEdgeType({
    type: 'same_as',
    label: 'same as',
    inverseLabel: 'same as',
    category: 'identity',
    directed: false,
    strokeToken: '--edge-identity',
    width: 2,
    arrowSource: 'dot',
    arrowTarget: 'dot',
    defaultRouting: 'straight',
  }),
  defineEdgeType({
    type: 'alias_of',
    label: 'alias of',
    inverseLabel: 'has alias',
    category: 'identity',
    strokeToken: '--edge-identity',
    dash: 'dash-dot',
    defaultRouting: 'curved',
    allowed: [
      {
        source: ['username', 'person', 'organization', 'domain'],
        target: ['username', 'person', 'organization', 'domain'],
      },
    ],
  }),
  defineEdgeType({
    type: 'has_account',
    label: 'has account',
    inverseLabel: 'belongs to',
    category: 'identity',
    strokeToken: '--edge-identity',
    allowed: [{ source: ACTORS, target: IDENTIFIERS }],
  }),
  defineEdgeType({
    type: 'owns',
    label: 'owns',
    inverseLabel: 'owned by',
    category: 'infrastructure',
    strokeToken: '--edge-infra',
    arrowSource: 'diamond',
    allowed: [{ source: ACTORS, target: ['domain', 'ip', 'repo', 'file', 'website'] }],
  }),
  defineEdgeType({
    type: 'member_of',
    label: 'member of',
    inverseLabel: 'has member',
    category: 'social',
    strokeToken: '--edge-social',
    arrowTarget: 'hollow',
    defaultRouting: 'curved',
    allowed: [{ source: ['person'], target: ['organization', 'group'] }],
  }),
  defineEdgeType({
    type: 'works_at',
    label: 'works at',
    inverseLabel: 'employs',
    category: 'social',
    strokeToken: '--edge-social',
    defaultRouting: 'curved',
    allowed: [{ source: ['person'], target: ['organization'] }],
  }),
  defineEdgeType({
    type: 'knows',
    label: 'knows',
    inverseLabel: 'knows',
    category: 'social',
    directed: false,
    strokeToken: '--edge-social',
    width: 1.25,
    defaultRouting: 'curved',
    allowSelfLoop: true,
    allowed: [{ source: ['person'], target: ['person'] }],
  }),
  defineEdgeType({
    type: 'communicates_with',
    label: 'communicates with',
    inverseLabel: 'communicates with',
    category: 'social',
    directed: false,
    strokeToken: '--edge-social',
    dash: 'dotted',
    defaultRouting: 'curved',
    allowSelfLoop: true,
    allowed: [{ source: ['person', 'username', 'email'], target: ['person', 'username', 'email'] }],
  }),
  defineEdgeType({
    type: 'resolves_to',
    label: 'resolves to',
    inverseLabel: 'resolved from',
    category: 'infrastructure',
    strokeToken: '--edge-infra',
    defaultRouting: 'orthogonal',
    inferred: true,
    allowed: [{ source: ['domain'], target: ['ip', 'domain'] }],
  }),
  defineEdgeType({
    type: 'hosted_on',
    label: 'hosted on',
    inverseLabel: 'hosts',
    category: 'infrastructure',
    strokeToken: '--edge-infra',
    defaultRouting: 'orthogonal',
    allowed: [{ source: ['website', 'domain', 'repo'], target: ['ip', 'organization'] }],
  }),
  defineEdgeType({
    type: 'part_of',
    label: 'part of',
    inverseLabel: 'contains',
    category: 'structural',
    strokeToken: '--edge-structure',
    arrowTarget: 'tee',
    defaultRouting: 'orthogonal',
    allowed: [{ source: [ANY], target: ['domain', 'organization', 'group', 'repo'] }],
  }),
  defineEdgeType({
    type: 'contributed_to',
    label: 'contributed to',
    inverseLabel: 'has contributor',
    category: 'code',
    strokeToken: '--edge-code',
    inferred: true,
    allowed: [{ source: ['person', 'username', 'organization'], target: ['repo'] }],
  }),
  defineEdgeType({
    type: 'depends_on',
    label: 'depends on',
    inverseLabel: 'is dependency of',
    category: 'code',
    strokeToken: '--edge-code',
    dash: 'dashed',
    defaultRouting: 'orthogonal',
    inferred: true,
    allowed: [{ source: ['repo'], target: ['repo'] }],
  }),
  defineEdgeType({
    type: 'forked_from',
    label: 'forked from',
    inverseLabel: 'has fork',
    category: 'code',
    strokeToken: '--edge-code',
    arrowTarget: 'hollow',
    defaultRouting: 'curved',
    inferred: true,
    allowed: [{ source: ['repo'], target: ['repo'] }],
  }),
  defineEdgeType({
    type: 'mentions',
    label: 'mentions',
    inverseLabel: 'mentioned in',
    category: 'structural',
    dash: 'dotted',
    defaultRouting: 'curved',
    allowSelfLoop: true,
    allowed: [{ source: ['text', 'evidence', 'website', 'file', 'repo', 'note'], target: [ANY] }],
  }),
  defineEdgeType({
    type: 'supports',
    label: 'supports',
    inverseLabel: 'supported by',
    category: 'reasoning',
    strokeToken: '--edge-positive',
    defaultRouting: 'curved',
    allowed: [{ source: EVIDENCE, target: ['hypothesis'] }],
  }),
  defineEdgeType({
    type: 'contradicts',
    label: 'contradicts',
    inverseLabel: 'contradicted by',
    category: 'reasoning',
    strokeToken: '--edge-danger',
    arrowTarget: 'tee',
    defaultRouting: 'curved',
    allowed: [{ source: EVIDENCE, target: ['hypothesis'] }],
  }),
  defineEdgeType({
    type: 'caused_by',
    label: 'caused by',
    inverseLabel: 'caused',
    category: 'temporal',
    strokeToken: '--edge-time',
    allowed: [{ source: ['timeline-event', ANY], target: ['timeline-event', ANY] }],
  }),
  defineEdgeType({
    type: 'precedes',
    label: 'precedes',
    inverseLabel: 'follows',
    category: 'temporal',
    strokeToken: '--edge-time',
    dash: 'dashed',
    defaultRouting: 'orthogonal',
    allowed: [{ source: ['timeline-event'], target: ['timeline-event'] }],
  }),
  defineEdgeType({
    type: 'located_at',
    label: 'located at',
    inverseLabel: 'location of',
    category: 'infrastructure',
    strokeToken: '--edge-geo',
    arrowTarget: 'dot',
    defaultRouting: 'curved',
    allowed: [
      {
        source: ['person', 'organization', 'ip', 'timeline-event', 'image'],
        target: ['location'],
      },
    ],
  }),
  defineEdgeType({
    type: CUSTOM_EDGE_TYPE,
    label: 'related to',
    inverseLabel: 'related to',
    category: 'structural',
    directed: false,
    dash: 'dashed',
    defaultRouting: 'curved',
    allowSelfLoop: true,
  }),
];

export function registerEdgeBuiltins(registry: EdgeTypeRegistry = edgeTypes): EdgeTypeRegistry {
  for (const def of builtinEdgeTypeDefinitions) registry.override(def);
  return registry;
}

/** The registry, guaranteed populated. Import this instead of `edgeTypes` from application code. */
export function builtinEdgeTypes(): EdgeTypeRegistry {
  if (!edgeTypes.has(CUSTOM_EDGE_TYPE)) registerEdgeBuiltins(edgeTypes);
  return edgeTypes;
}
