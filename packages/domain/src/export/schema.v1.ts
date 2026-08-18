/**
 * `raven.board.v1` — the portable board archive (08_DATA_MODEL.md §8.1). Every field that enters a
 * document through an import is validated here first (P3 §9): unknown node types are imported as
 * generic cards, unknown keys are preserved, nothing is executed.
 */

import { z } from 'zod';

import { EdgeSchema } from '../entities/edge.ts';
import { AssetSchema, BoardMetaSchema, GroupSchema } from '../entities/group.ts';
import { NodeSchema } from '../entities/node.ts';
import { RichTextDocJsonSchema } from './richtext.ts';

export const BOARD_EXPORT_FORMAT = 'raven.board.v1';

/**
 * Archives written before the NEXUS → Raven rename. They are byte-identical apart from the
 * brand strings, so `normalizeLegacyBrand` (doc/migrations.ts) rewrites them on import and every
 * pre-rename board keeps opening forever.
 */
export const LEGACY_BOARD_EXPORT_FORMATS: readonly string[] = ['nexus.board.v1', 'nexus.board.v0'];
export const LEGACY_GENERATOR_APP = 'nexus';
export const GENERATOR_APP = 'raven';

/** Hard ceiling for a single import; rejected before any mutation (P3 §8). */
export const IMPORT_NODE_LIMIT = 20_000;

export const FileManifestSchema = AssetSchema.omit({ createdAt: true })
  .extend({
    /** Present only inside a `.raven` archive; a bare JSON export sets null. */
    path: z.string().nullable().default(null),
    metadata: z.record(z.unknown()).default({}),
  })
  .passthrough();

export const BoardExportV1Schema = z
  .object({
    format: z.literal(BOARD_EXPORT_FORMAT),
    exportedAt: z.string(),
    generator: z.object({
      app: z.literal('raven'),
      version: z.string(),
      schemaVersion: z.number().int().min(1),
    }),
    board: BoardMetaSchema,
    nodes: z.array(NodeSchema),
    edges: z.array(EdgeSchema),
    groups: z.array(GroupSchema),
    richtext: z.record(RichTextDocJsonSchema),
    order: z.array(z.string()),
    files: z.array(FileManifestSchema),
    comments: z.array(z.record(z.unknown())),
    extensions: z.record(z.unknown()),
  })
  .passthrough();

export type BoardExportV1 = z.infer<typeof BoardExportV1Schema>;
export type FileManifest = z.infer<typeof FileManifestSchema>;

/**
 * Deterministic serialisation: the same document must produce byte-identical JSON so exports diff
 * meaningfully and the round-trip property test can compare strings (P3 §7).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) out[key] = sortKeys(record[key]);
  return out;
}
