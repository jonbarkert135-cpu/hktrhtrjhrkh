/**
 * Group records — frames and clusters (08_DATA_MODEL.md §2.2 / §8.1). `childIds` and the children's
 * `parentId` are kept symmetric by the mutation helpers and checked by `checkGraphInvariants` (§7.3).
 */

import { z } from 'zod';

import { IsoDateSchema } from './provenance.ts';

const finite = z.number().finite();

export const GroupSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['frame', 'cluster']).default('frame'),
    label: z.string().default(''),
    x: finite,
    y: finite,
    w: finite.min(1),
    h: finite.min(1),
    collapsed: z.boolean().default(false),
    parentId: z.string().nullable().default(null),
    padding: finite.min(0).default(24),
    background: z.string().nullable().default(null),
    childIds: z.array(z.string()).default([]),
    autoLayout: z.enum(['none', 'grid', 'row', 'column']).default('none'),
    version: z.number().int().min(1).default(1),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
    deletedAt: IsoDateSchema.nullable().default(null),
  })
  .passthrough();

export type BoardGroup = z.infer<typeof GroupSchema>;

export interface NewGroupInput {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  childIds?: string[];
}

export function makeGroup(input: NewGroupInput, now: string): BoardGroup {
  return GroupSchema.parse({
    id: input.id,
    x: input.x,
    y: input.y,
    w: input.w,
    h: input.h,
    label: input.label ?? '',
    childIds: input.childIds ?? [],
    createdAt: now,
    updatedAt: now,
  });
}

/** Board-local asset index (08 §2.2.6). Bytes live in OPFS/S3, never in the CRDT. */
export const AssetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().default(''),
    mime: z.string().default('application/octet-stream'),
    size: z.number().int().min(0).default(0),
    sha256: z.string().nullable().default(null),
    state: z.enum(['local', 'uploading', 'synced', 'missing']).default('local'),
    createdAt: IsoDateSchema,
  })
  .passthrough();

export type BoardAsset = z.infer<typeof AssetSchema>;

export const BoardMetaSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    boardId: z.string().min(1),
    projectId: z.string().nullable().default(null),
    title: z.string().default('Untitled board'),
    description: z.string().default(''),
    background: z.enum(['grid', 'dots', 'plain']).default('dots'),
    defaultEdgeRouting: z.enum(['straight', 'curved', 'orthogonal', 'smart']).default('smart'),
    tagPalette: z.record(z.string()).default({}),
    savedViews: z.array(z.record(z.unknown())).default([]),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
    lastMigratedAt: IsoDateSchema.nullable().default(null),
  })
  .passthrough();

export type BoardMeta = z.infer<typeof BoardMetaSchema>;
