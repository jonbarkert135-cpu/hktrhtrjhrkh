/**
 * Edge records (08_DATA_MODEL.md §2.2.3 / §8.1). Endpoints and style are separate objects because
 * re-attaching an endpoint and restyling an edge are independent concurrent operations; the full
 * routing/label model lands in P5 behind these same fields.
 */

import { z } from 'zod';

import { IsoDateSchema, ProvenanceSchema } from './provenance.ts';

export const EDGE_PORTS = ['auto', 'top', 'right', 'bottom', 'left'] as const;
export const EDGE_ROUTINGS = ['straight', 'curved', 'orthogonal', 'smart'] as const;

const finite = z.number().finite();

export const EndpointSchema = z
  .object({
    nodeId: z.string().min(1),
    port: z.enum(EDGE_PORTS).default('auto'),
    offset: finite.min(0).max(1).default(0.5),
    anchorKey: z.string().nullable().default(null),
  })
  .passthrough();

export const EdgeStyleSchema = z
  .object({
    routing: z.enum(EDGE_ROUTINGS).nullable().default(null),
    stroke: z.string().nullable().default(null),
    width: finite.nullable().default(null),
    dash: z.array(finite).nullable().default(null),
    arrowSource: z.boolean().nullable().default(null),
    arrowTarget: z.boolean().nullable().default(null),
    animated: z.boolean().nullable().default(null),
    labelPosition: finite.min(0).max(1).default(0.5),
    labelOffset: z.object({ dx: finite, dy: finite }).default({ dx: 0, dy: 0 }),
    curvature: finite.nullable().default(null),
    cornerRadius: finite.nullable().default(null),
    zBias: z.number().int().default(0),
  })
  .passthrough();

export const EdgeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1).default('related_to'),
    source: EndpointSchema,
    target: EndpointSchema,
    directed: z.boolean().default(true),
    label: z.string().default(''),
    description: z.string().nullable().default(null),
    confidence: z.enum(['low', 'medium', 'high', 'unknown']).default('unknown'),
    weight: finite.min(0).max(1).default(0.5),
    observedAt: IsoDateSchema.nullable().default(null),
    validFrom: IsoDateSchema.nullable().default(null),
    validTo: IsoDateSchema.nullable().default(null),
    tags: z.array(z.string()).max(64).default([]),
    waypoints: z.array(z.object({ x: finite, y: finite })).default([]),
    manualRoute: z.boolean().default(false),
    style: EdgeStyleSchema.default({}),
    locked: z.boolean().default(false),
    hidden: z.boolean().default(false),
    status: z.enum(['active', 'archived', 'deleted']).default('active'),
    provenance: ProvenanceSchema,
    version: z.number().int().min(1).default(1),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
    deletedAt: IsoDateSchema.nullable().default(null),
    data: z.record(z.unknown()).default({}),
  })
  .passthrough();

export type BoardEdge = z.infer<typeof EdgeSchema>;

export interface NewEdgeInput {
  id: string;
  from: string;
  to: string;
  type?: string;
  fromPort?: (typeof EDGE_PORTS)[number];
  toPort?: (typeof EDGE_PORTS)[number];
  label?: string;
  provenance?: unknown;
}

export function makeEdge(input: NewEdgeInput, now: string): BoardEdge {
  return EdgeSchema.parse({
    id: input.id,
    type: input.type ?? 'related_to',
    source: { nodeId: input.from, port: input.fromPort ?? 'auto' },
    target: { nodeId: input.to, port: input.toPort ?? 'auto' },
    label: input.label ?? '',
    provenance: input.provenance ?? { kind: 'manual', observedAt: now, importedAt: now },
    createdAt: now,
    updatedAt: now,
  });
}
