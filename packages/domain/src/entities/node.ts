/**
 * Node records (08_DATA_MODEL.md §2.2.2 / §8.1). P3 freezes `EntityBase`; the per-type payloads in
 * `data` arrive with the node registry in P4, so `data` is validated as an open record and its
 * unknown keys are preserved verbatim (N9 round-trip, forward compatibility).
 */

import { z } from 'zod';

import { IsoDateSchema, ProvenanceSchema } from './provenance.ts';

export const NODE_STATUSES = ['active', 'archived', 'deleted'] as const;
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high', 'unknown'] as const;

/** A node type the client does not know is rendered as a generic card, never executed (P3 §9). */
export const UNKNOWN_NODE_TYPE = 'unknown';

export const EnrichmentSchema = z
  .object({
    state: z.enum(['idle', 'queued', 'running', 'ready', 'error']).default('idle'),
    jobId: z.string().nullable().default(null),
    attempts: z.number().int().min(0).default(0),
    lastError: z.string().nullable().default(null),
    updatedAt: IsoDateSchema.nullable().default(null),
  })
  .passthrough();

const finite = z.number().finite();

export const NodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1).default(UNKNOWN_NODE_TYPE),
    x: finite,
    y: finite,
    w: finite.min(1),
    h: finite.min(1),
    z: z.number().int().default(0),
    /** Nodes never rotate in v1 (05_CANVAS_ENGINE.md §12 R7); the field exists for later. */
    rotation: z.literal(0).default(0),
    parentId: z.string().nullable().default(null),
    locked: z.boolean().default(false),
    hidden: z.boolean().default(false),
    title: z.string().default(''),
    tags: z.array(z.string()).max(64).default([]),
    confidence: z.enum(CONFIDENCE_LEVELS).default('unknown'),
    color: z.string().nullable().default(null),
    starred: z.boolean().default(false),
    status: z.enum(NODE_STATUSES).default('active'),
    provenance: ProvenanceSchema,
    enrichment: EnrichmentSchema.default({}),
    version: z.number().int().min(1).default(1),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
    deletedAt: IsoDateSchema.nullable().default(null),
    data: z.record(z.unknown()).default({}),
  })
  .passthrough();

export type BoardNode = z.infer<typeof NodeSchema>;

export interface NewNodeInput {
  id: string;
  type?: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  z?: number;
  title?: string;
  tags?: string[];
  data?: Record<string, unknown>;
  provenance?: unknown;
}

export const DEFAULT_NODE_WIDTH = 280;
export const DEFAULT_NODE_HEIGHT = 160;

/** Fills every required field so callers only pass what a capture flow actually knows. */
export function makeNode(input: NewNodeInput, now: string): BoardNode {
  return NodeSchema.parse({
    id: input.id,
    type: input.type ?? UNKNOWN_NODE_TYPE,
    x: input.x,
    y: input.y,
    w: input.w ?? DEFAULT_NODE_WIDTH,
    h: input.h ?? DEFAULT_NODE_HEIGHT,
    z: input.z ?? 0,
    title: input.title ?? '',
    tags: input.tags ?? [],
    data: input.data ?? {},
    provenance: input.provenance ?? { kind: 'manual', observedAt: now, importedAt: now },
    createdAt: now,
    updatedAt: now,
  });
}
