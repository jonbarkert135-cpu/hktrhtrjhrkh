/**
 * `image` — a picture stored as a File row (06_NODE_SYSTEM.md §4.4). EXIF is kept because it is
 * OSINT-relevant, and the GPS flag is surfaced in the UI: an analyst must see that coordinates
 * exist, but NEXUS never turns them into a location node without an explicit action (P4 §7).
 */

import { z } from 'zod';

import { clean, defineNodeType, jsonIo, keywords, nullableText } from '../define.ts';
import type { NodeTypeDefinition } from '../types.ts';

/** Decompression-bomb guard: a 20,000 × 20,000 PNG is 1.6 GB decoded (06 §8). */
export const MAX_IMAGE_PIXELS = 80_000_000;

export const ImageExifSchema = z
  .object({
    hasGps: z.boolean().default(false),
    lat: z.number().nullable().default(null),
    lon: z.number().nullable().default(null),
    takenAt: nullableText(40),
    camera: nullableText(200),
  })
  .passthrough();

export const ImageDataSchema = z
  .object({
    fileId: z.string().default(''),
    naturalWidth: z.number().int().min(0).default(0),
    naturalHeight: z.number().int().min(0).default(0),
    alt: nullableText(500),
    dominantColor: nullableText(16),
    thumbnailFileId: z.string().nullable().default(null),
    uploadState: z.enum(['pending', 'uploading', 'ready', 'failed']).default('pending'),
    exif: ImageExifSchema.nullable().default(null),
  })
  .passthrough();

export type ImageData = z.infer<typeof ImageDataSchema>;

export const imageType: NodeTypeDefinition<ImageData> = defineNodeType<ImageData>({
  type: 'image',
  label: 'Image',
  labelPlural: 'Images',
  schema: ImageDataSchema,
  glyph: { colorToken: '--entity-image-fg', icon: 'image', shape: 'rounded' },
  defaults: {
    size: { w: 320, h: 240 },
    minSize: { w: 80, h: 60 },
    maxSize: { w: 1600, h: 1600 },
    resize: 'ratio',
    autoHeight: false,
    data: ImageDataSchema.parse({}),
  },
  capabilities: {
    editableText: false,
    resizable: true,
    connectable: true,
    groupable: true,
    enrichable: true,
    duplicatable: true,
    hasMedia: true,
    aiSummarizable: true,
  },
  componentId: 'node.image',
  inspector: [
    {
      key: 'data.alt',
      label: 'Alt text',
      control: 'text',
      section: 'content',
      help: 'Read by screen readers.',
    },
    { key: 'data.fileId', label: 'File', control: 'file', section: 'content' },
    { key: 'data.naturalWidth', label: 'Width', control: 'readonly', section: 'attributes' },
    { key: 'data.naturalHeight', label: 'Height', control: 'readonly', section: 'attributes' },
    { key: 'data.exif', label: 'EXIF', control: 'json', section: 'provenance' },
  ],
  identityKeys: (node) => (node.data.fileId === '' ? [] : [`file:${node.data.fileId}`]),
  searchFields: (node) => ({
    title: clean(node.title, 300),
    body: clean(node.data.alt, 500),
    keywords: keywords(node.data.exif?.camera, node.data.exif?.hasGps === true ? 'gps' : null),
  }),
  validate: (node) => {
    const pixels = node.data.naturalWidth * node.data.naturalHeight;
    if (pixels > MAX_IMAGE_PIXELS) {
      return [
        {
          code: 'IMAGE_TOO_LARGE',
          field: 'data.naturalWidth',
          severity: 'error' as const,
          message: `This image is ${String(node.data.naturalWidth)} × ${String(node.data.naturalHeight)} pixels, above the 80 megapixel decode limit. Downscale it before adding it.`,
        },
      ];
    }
    return [];
  },
  capture: {
    // Browsers hand over an empty `type` for some drags, so the extension is the fallback signal.
    match: (input) =>
      input.kind === 'file' &&
      ((input.mime ?? '').startsWith('image/') ||
        /\.(png|jpe?g|gif|webp|avif|bmp|tiff?)$/i.test(input.filename ?? ''))
        ? 0.9
        : 0,
    build: (input) => ({
      title: input.filename ?? 'Image',
      data: { uploadState: 'pending' as const },
    }),
  },
  io: {
    ...jsonIo(ImageDataSchema),
    toMarkdown: (node) => `![${node.data.alt ?? node.title}](file:${node.data.fileId})`,
  },
});
