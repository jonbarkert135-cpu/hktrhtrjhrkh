/**
 * `website` — a captured web page with unfurled metadata (06_NODE_SYSTEM.md §4.1). Only `url` is
 * user-supplied; everything else is enrichment output and may be absent, which is why the card has
 * a real `partial` state instead of pretending the fetch always succeeds.
 */

import { z } from 'zod';

import {
  clean,
  defineNodeType,
  hostOf,
  jsonIo,
  keywords,
  nullableText,
  urlIssues,
} from '../define.ts';
import type { NodeTypeDefinition } from '../types.ts';

export const WEBSITE_STATUSES = ['pending', 'ok', 'failed'] as const;

export const WebsiteDataSchema = z
  .object({
    url: z.string().max(2048).default(''),
    title: nullableText(300),
    description: nullableText(1200),
    siteName: nullableText(200),
    faviconFileId: z.string().nullable().default(null),
    screenshotFileId: z.string().nullable().default(null),
    finalUrl: nullableText(2048),
    httpStatus: z.number().int().min(100).max(599).nullable().default(null),
    lang: nullableText(16),
    author: nullableText(200),
    publishedAt: nullableText(40),
    excerpt: nullableText(4000),
    fetchedAt: nullableText(40),
    status: z.enum(WEBSITE_STATUSES).default('pending'),
  })
  .passthrough();

export type WebsiteData = z.infer<typeof WebsiteDataSchema>;

export const websiteType: NodeTypeDefinition<WebsiteData> = defineNodeType<WebsiteData>({
  type: 'website',
  label: 'Website',
  labelPlural: 'Websites',
  schema: WebsiteDataSchema,
  glyph: { colorToken: '--entity-page-fg', icon: 'globe', shape: 'rounded' },
  defaults: {
    size: { w: 320, h: 188 },
    minSize: { w: 220, h: 96 },
    maxSize: { w: 720, h: 640 },
    resize: 'width',
    autoHeight: false,
    data: WebsiteDataSchema.parse({}),
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
  componentId: 'node.website',
  inspector: [
    {
      key: 'data.url',
      label: 'URL',
      control: 'url',
      section: 'identity',
      required: true,
      placeholder: 'https://',
    },
    { key: 'data.description', label: 'Description', control: 'textarea', section: 'content' },
    { key: 'data.author', label: 'Author', control: 'text', section: 'attributes' },
    { key: 'data.publishedAt', label: 'Published', control: 'datetime', section: 'attributes' },
    {
      key: 'data.status',
      label: 'Fetch status',
      control: 'select',
      section: 'attributes',
      options: [
        { value: 'pending', label: 'Pending' },
        { value: 'ok', label: 'Fetched' },
        { value: 'failed', label: 'Failed' },
      ],
    },
    { key: 'data.httpStatus', label: 'HTTP status', control: 'readonly', section: 'provenance' },
    { key: 'data.finalUrl', label: 'Final URL', control: 'readonly', section: 'provenance' },
    { key: 'data.fetchedAt', label: 'Fetched at', control: 'readonly', section: 'provenance' },
  ],
  identityKeys: (node) => {
    const url = node.data.url;
    if (url === '') return [];
    const host = hostOf(url);
    return host === '' ? [] : [`website:${url.toLowerCase()}`];
  },
  searchFields: (node) => ({
    title: clean(node.title !== '' ? node.title : (node.data.title ?? hostOf(node.data.url)), 300),
    body: clean(`${node.data.description ?? ''} ${node.data.excerpt ?? ''}`),
    keywords: keywords(hostOf(node.data.url), node.data.siteName, node.data.author, node.data.lang),
  }),
  validate: (node) =>
    urlIssues(node.data.url, 'The URL').map((issue) => ({
      ...issue,
      field: 'data.url',
      severity: issue.code === 'URL_PRIVATE_RANGE' ? ('warning' as const) : ('error' as const),
    })),
  capture: {
    match: (input) => (input.kind === 'url' ? 0.8 : 0),
    build: (input) => {
      const url = input.text ?? '';
      return { title: hostOf(url), data: { url, status: 'pending' as const } };
    },
  },
  io: {
    ...jsonIo(WebsiteDataSchema),
    toMarkdown: (node) => {
      const label = node.title !== '' ? node.title : (node.data.title ?? node.data.url);
      const description = node.data.description ?? '';
      return `[${label}](${node.data.url})${description === '' ? '' : `\n\n${description}`}`;
    },
  },
});
