/**
 * `unknown` — the fallback for a payload this build does not recognise: a node created by a newer
 * client, by a plugin that is not installed, or by an import from a future schema version
 * (06_NODE_SYSTEM.md §4.21, 08_DATA_MODEL.md §2.6).
 *
 * The payload is preserved verbatim and rendered read-only as JSON. It is never executed, never
 * normalised and never dropped — dropping it would silently destroy another client's data on the
 * next save.
 */

import { z } from 'zod';

import { clean, defineNodeType } from '../define.ts';
import { UNKNOWN_NODE_TYPE } from '../../entities/node.ts';
import type { NodeTypeDefinition } from '../types.ts';

export const UnknownDataSchema = z.record(z.unknown()).default({});

export type UnknownData = z.infer<typeof UnknownDataSchema>;

/** Depth-limited, order-stable text extraction so unknown payloads are still searchable. */
function flatten(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === 'string') return [value.slice(0, 400)];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => flatten(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      flatten(item, depth + 1),
    );
  }
  return [];
}

export const unknownType: NodeTypeDefinition<UnknownData> = defineNodeType<UnknownData>({
  type: UNKNOWN_NODE_TYPE,
  label: 'Unknown',
  labelPlural: 'Unknown',
  schema: UnknownDataSchema,
  glyph: { colorToken: '--entity-toolrun-fg', icon: 'help-circle', shape: 'diamond' },
  defaults: {
    size: { w: 280, h: 160 },
    minSize: { w: 160, h: 88 },
    maxSize: { w: 720, h: 900 },
    resize: 'free',
    autoHeight: false,
    data: {},
  },
  capabilities: {
    editableText: false,
    resizable: true,
    connectable: true,
    groupable: true,
    enrichable: false,
    duplicatable: true,
    hasMedia: false,
    aiSummarizable: false,
  },
  componentId: 'node.unknown',
  inspector: [
    { key: 'type', label: 'Original type', control: 'readonly', section: 'identity' },
    {
      key: 'data',
      label: 'Payload',
      control: 'json',
      section: 'content',
      help: 'Shown read-only. This build does not know this node type, so the data is kept exactly as received.',
    },
  ],
  identityKeys: () => [],
  searchFields: (node) => ({
    title: clean(node.title !== '' ? node.title : node.type, 300),
    body: clean(flatten(node.data).join(' '), 4000),
    keywords: [node.type],
  }),
  io: {
    toExport: (node) => ({ ...node.data }),
    fromExport: (raw) => (typeof raw === 'object' && raw !== null ? (raw as UnknownData) : {}),
    toMarkdown: (node) => `\`\`\`json\n${JSON.stringify(node.data, null, 2)}\n\`\`\``,
  },
});
