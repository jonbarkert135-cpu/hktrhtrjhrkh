/**
 * Provenance travels with every node and edge (08_DATA_MODEL.md §8.1, invariant §7.8): where the
 * record came from, which tool produced it and when it was observed. It is a plain object,
 * replaced wholesale, because exactly one writer produces it at a time.
 */

import { z } from 'zod';

export const PROVENANCE_KINDS = [
  'manual',
  'paste',
  'drop',
  'import',
  'tool',
  'ai',
  'sync',
] as const;

export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

/** ISO-8601 in UTC. Timestamps are data, never an ordering key (P3 §8: clock skew). */
export const IsoDateSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'expected an ISO-8601 date' });

export const ProvenanceSchema = z
  .object({
    kind: z.enum(PROVENANCE_KINDS).catch('manual'),
    source: z.string().nullable().default(null),
    tool: z.string().nullable().default(null),
    runId: z.string().nullable().default(null),
    proposalId: z.string().nullable().default(null),
    rawRef: z.string().nullable().default(null),
    observedAt: IsoDateSchema.nullable().default(null),
    importedAt: IsoDateSchema.nullable().default(null),
    actorId: z.string().nullable().default(null),
    confidence: z.enum(['low', 'medium', 'high', 'unknown']).default('unknown'),
  })
  // Unknown keys are preserved, never stripped (08 §2.2.2 forward compatibility).
  .passthrough();

export type Provenance = z.infer<typeof ProvenanceSchema>;

export function manualProvenance(at: string, actorId: string | null = null): Provenance {
  return ProvenanceSchema.parse({
    kind: 'manual',
    observedAt: at,
    importedAt: at,
    actorId,
  });
}
