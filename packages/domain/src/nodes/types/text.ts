/**
 * `text` — the primary writing surface (06_NODE_SYSTEM.md §4.3). The content lives in a
 * `Y.XmlFragment` under the document's `richtext` root, keyed by `data.fragmentKey`; `data.plain`
 * is a denormalised copy kept only for search and for the L1 painter, never for editing.
 */

import { z } from 'zod';

import { clean, defineNodeType, jsonIo, keywords, nullableText } from '../define.ts';
import type { NodeTypeDefinition } from '../types.ts';

export const TEXT_FORMATS = ['rich', 'markdown', 'code'] as const;

/** Rich text is a note, not a document: 200 KB hard cap, warning at 150 KB (06 §8). */
export const RICH_TEXT_WARN_BYTES = 150_000;
export const RICH_TEXT_MAX_BYTES = 200_000;

/** The denormalised `plain` copy is a search/preview projection, not the content itself. */
export const PLAIN_TEXT_MAX_CHARS = 20_000;

export interface RichTextSizeIssue {
  level: 'warn' | 'block';
  message: string;
}

/**
 * The editor's guard rail (P4 §8): warn at 150 KB, refuse the keystroke at 200 KB. Lives in the
 * domain so the same numbers apply to import and to paste, not only to typing.
 */
export function richTextSizeIssue(bytes: number): RichTextSizeIssue | null {
  if (bytes > RICH_TEXT_MAX_BYTES) {
    return {
      level: 'block',
      message: `This note is ${String(Math.round(bytes / 1000))} KB; the limit is 200 KB. Split it into two notes.`,
    };
  }
  if (bytes > RICH_TEXT_WARN_BYTES) {
    return {
      level: 'warn',
      message: `This note is ${String(Math.round(bytes / 1000))} KB. Editing stays responsive up to 200 KB.`,
    };
  }
  return null;
}

export const TextDataSchema = z
  .object({
    fragmentKey: z.string().max(64).default(''),
    plain: z.string().max(PLAIN_TEXT_MAX_CHARS).default(''),
    format: z.enum(TEXT_FORMATS).default('rich'),
    codeLanguage: nullableText(32),
  })
  .passthrough();

export type TextData = z.infer<typeof TextDataSchema>;

export const textType: NodeTypeDefinition<TextData> = defineNodeType<TextData>({
  type: 'text',
  label: 'Text',
  labelPlural: 'Text notes',
  schema: TextDataSchema,
  glyph: { colorToken: '--entity-text-fg', icon: 'type', shape: 'rounded' },
  defaults: {
    size: { w: 320, h: 200 },
    minSize: { w: 120, h: 64 },
    maxSize: { w: 1200, h: 3000 },
    resize: 'free',
    autoHeight: true,
    data: TextDataSchema.parse({}),
  },
  capabilities: {
    editableText: true,
    resizable: true,
    connectable: true,
    groupable: true,
    enrichable: false,
    duplicatable: true,
    hasMedia: false,
    aiSummarizable: true,
  },
  componentId: 'node.text',
  inspector: [
    { key: 'body', label: 'Content', control: 'richtext', section: 'content' },
    {
      key: 'data.format',
      label: 'Format',
      control: 'select',
      section: 'attributes',
      options: TEXT_FORMATS.map((value) => ({ value, label: value })),
    },
    {
      key: 'data.codeLanguage',
      label: 'Code language',
      control: 'text',
      section: 'attributes',
      help: 'Used for highlighting when the format is code.',
    },
  ],
  // Two notes with the same words are not the same note: text is never auto-deduped.
  identityKeys: () => [],
  searchFields: (node) => ({
    title: clean(node.title, 300),
    body: clean(node.data.plain, 20_000),
    keywords: keywords(node.data.format, node.data.codeLanguage),
  }),
  validate: (node) => {
    const chars = node.data.plain.length;
    if (chars >= PLAIN_TEXT_MAX_CHARS * 0.9) {
      return [
        {
          code: 'TEXT_LONG',
          field: 'data.plain',
          severity: 'warning' as const,
          message: `This note is close to the ${String(PLAIN_TEXT_MAX_CHARS)} character preview limit. Longer text is kept in the body but not indexed for search.`,
        },
      ];
    }
    return [];
  },
  capture: {
    match: (input) => (input.kind === 'text' ? 0.6 : 0),
    build: (input) => {
      const text = input.text ?? '';
      return { title: clean(text, 96), data: { plain: text.slice(0, 20_000) } };
    },
  },
  io: {
    ...jsonIo(TextDataSchema),
    toMarkdown: (node) =>
      node.data.format === 'code'
        ? `\`\`\`${node.data.codeLanguage ?? ''}\n${node.data.plain}\n\`\`\``
        : node.data.plain,
  },
});
