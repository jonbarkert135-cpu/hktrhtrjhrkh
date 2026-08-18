/**
 * `note` — an analyst's finding (06_NODE_SYSTEM.md §4.6). Same rich-text body as `text`, plus a
 * severity that drives the card accent and a `sourceRef` pointing at what the finding is about.
 */

import { z } from 'zod';

import { clean, defineNodeType, jsonIo, keywords, nullableText } from '../define.ts';
import type { NodeTypeDefinition } from '../types.ts';

export const NOTE_SEVERITIES = ['info', 'finding', 'critical'] as const;
export type NoteSeverity = (typeof NOTE_SEVERITIES)[number];

export const NoteDataSchema = z
  .object({
    fragmentKey: z.string().max(64).default(''),
    plain: z.string().max(20_000).default(''),
    severity: z.enum(NOTE_SEVERITIES).default('info'),
    /** Node id, URL or file name the finding refers to. */
    sourceRef: nullableText(2048),
  })
  .passthrough();

export type NoteData = z.infer<typeof NoteDataSchema>;

export const noteType: NodeTypeDefinition<NoteData> = defineNodeType<NoteData>({
  type: 'note',
  label: 'Note',
  labelPlural: 'Notes',
  schema: NoteDataSchema,
  glyph: { colorToken: '--entity-note-fg', icon: 'sticky-note', shape: 'rounded' },
  defaults: {
    size: { w: 280, h: 160 },
    minSize: { w: 140, h: 72 },
    maxSize: { w: 900, h: 1200 },
    resize: 'free',
    autoHeight: true,
    data: NoteDataSchema.parse({}),
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
  componentId: 'node.note',
  inspector: [
    { key: 'body', label: 'Finding', control: 'richtext', section: 'content' },
    {
      key: 'data.severity',
      label: 'Severity',
      control: 'select',
      section: 'attributes',
      options: [
        { value: 'info', label: 'Info' },
        { value: 'finding', label: 'Finding' },
        { value: 'critical', label: 'Critical' },
      ],
    },
    {
      key: 'data.sourceRef',
      label: 'Refers to',
      control: 'text',
      section: 'provenance',
      help: 'A node id, URL or file this finding is about.',
    },
  ],
  identityKeys: () => [],
  searchFields: (node) => ({
    title: clean(node.title, 300),
    body: clean(node.data.plain, 20_000),
    keywords: keywords(node.data.severity, node.data.sourceRef),
  }),
  capture: {
    match: (input) => (input.kind === 'text' ? 0.3 : 0),
    build: (input) => ({
      title: clean(input.text, 96),
      data: { plain: (input.text ?? '').slice(0, 20_000) },
    }),
  },
  io: {
    ...jsonIo(NoteDataSchema),
    toMarkdown: (node) => {
      const heading = node.title === '' ? 'Note' : node.title;
      return `### ${heading} (${node.data.severity})\n\n${node.data.plain}`;
    },
  },
});
