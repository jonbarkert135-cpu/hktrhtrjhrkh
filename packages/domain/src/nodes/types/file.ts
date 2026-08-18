/**
 * `file` — any uploaded artefact that is not an image (06_NODE_SYSTEM.md §4.5). An unsupported
 * type is not an error: the node is created with a generic icon and no preview, because losing the
 * evidence is worse than losing the thumbnail.
 */

import { z } from 'zod';

import { clean, defineNodeType, jsonIo, keywords, nullableText } from '../define.ts';
import type { NodeTypeDefinition } from '../types.ts';

/** Upload ceiling (15_SECURITY.md §5); the server enforces the same number. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const FileDataSchema = z
  .object({
    fileId: z.string().default(''),
    filename: z.string().max(400).default(''),
    mime: z.string().max(160).default('application/octet-stream'),
    size: z.number().int().min(0).default(0),
    sha256: nullableText(64),
    pages: z.number().int().min(0).nullable().default(null),
    previewFileId: z.string().nullable().default(null),
    uploadState: z.enum(['pending', 'uploading', 'ready', 'failed']).default('pending'),
    uploadError: nullableText(500),
  })
  .passthrough();

export type FileData = z.infer<typeof FileDataSchema>;

export const fileType: NodeTypeDefinition<FileData> = defineNodeType<FileData>({
  type: 'file',
  label: 'File',
  labelPlural: 'Files',
  schema: FileDataSchema,
  glyph: { colorToken: '--entity-file-fg', icon: 'file', shape: 'document' },
  defaults: {
    size: { w: 280, h: 120 },
    minSize: { w: 180, h: 88 },
    maxSize: { w: 720, h: 900 },
    resize: 'width',
    autoHeight: true,
    data: FileDataSchema.parse({}),
  },
  capabilities: {
    editableText: false,
    resizable: true,
    connectable: true,
    groupable: true,
    enrichable: true,
    duplicatable: true,
    hasMedia: true,
    aiSummarizable: false,
  },
  componentId: 'node.file',
  inspector: [
    { key: 'data.filename', label: 'Filename', control: 'text', section: 'identity' },
    { key: 'data.mime', label: 'Type', control: 'readonly', section: 'attributes' },
    { key: 'data.size', label: 'Size', control: 'readonly', section: 'attributes' },
    { key: 'data.pages', label: 'Pages', control: 'readonly', section: 'attributes' },
    { key: 'data.sha256', label: 'SHA-256', control: 'readonly', section: 'provenance' },
  ],
  identityKeys: (node) => {
    const keys: string[] = [];
    if (node.data.sha256 !== null && node.data.sha256 !== '')
      keys.push(`sha256:${node.data.sha256}`);
    if (node.data.fileId !== '') keys.push(`file:${node.data.fileId}`);
    return keys;
  },
  searchFields: (node) => ({
    title: clean(node.title !== '' ? node.title : node.data.filename, 300),
    body: clean(node.data.filename, 400),
    keywords: keywords(node.data.mime, node.data.sha256),
  }),
  validate: (node) => {
    if (node.data.size > MAX_UPLOAD_BYTES) {
      return [
        {
          code: 'FILE_TOO_LARGE',
          field: 'data.size',
          severity: 'error' as const,
          message: `This file is ${String(Math.round(node.data.size / 1_000_000))} MB, the limit is 100 MB. Compress it or link to it instead.`,
        },
      ];
    }
    return [];
  },
  capture: {
    match: (input) => (input.kind === 'file' ? 0.5 : 0),
    build: (input) => ({
      title: input.filename ?? 'File',
      data: {
        filename: input.filename ?? '',
        mime: input.mime ?? 'application/octet-stream',
        size: input.size ?? 0,
        uploadState: 'pending' as const,
      },
    }),
  },
  io: {
    ...jsonIo(FileDataSchema),
    toMarkdown: (node) =>
      `[${node.data.filename === '' ? node.title : node.data.filename}](file:${node.data.fileId})`,
  },
});
