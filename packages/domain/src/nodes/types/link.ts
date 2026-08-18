/**
 * `link` — a bare reference the user does not want unfurled, or a `website` whose unfurl failed and
 * was demoted (06_NODE_SYSTEM.md §4.2). Cheap and list-friendly: no preview, no network access.
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

export const LinkDataSchema = z
  .object({
    url: z.string().max(2048).default(''),
    label: nullableText(200),
    unfurlOptOut: z.boolean().default(false),
  })
  .passthrough();

export type LinkData = z.infer<typeof LinkDataSchema>;

export const linkType: NodeTypeDefinition<LinkData> = defineNodeType<LinkData>({
  type: 'link',
  label: 'Link',
  labelPlural: 'Links',
  schema: LinkDataSchema,
  glyph: { colorToken: '--entity-url-fg', icon: 'link', shape: 'rounded' },
  defaults: {
    size: { w: 260, h: 64 },
    minSize: { w: 160, h: 48 },
    maxSize: { w: 640, h: 120 },
    resize: 'width',
    autoHeight: true,
    data: LinkDataSchema.parse({}),
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
  componentId: 'node.link',
  inspector: [
    {
      key: 'data.url',
      label: 'URL',
      control: 'url',
      section: 'identity',
      required: true,
      placeholder: 'https://',
    },
    {
      key: 'data.label',
      label: 'Label',
      control: 'text',
      section: 'identity',
      help: 'Shown instead of the host.',
    },
    {
      key: 'data.unfurlOptOut',
      label: 'Never unfurl',
      control: 'toggle',
      section: 'attributes',
      help: 'Keeps this link out of the enrichment queue.',
    },
  ],
  identityKeys: (node) => (node.data.url === '' ? [] : [`link:${node.data.url.toLowerCase()}`]),
  searchFields: (node) => ({
    title: clean(node.title !== '' ? node.title : (node.data.label ?? hostOf(node.data.url)), 300),
    body: clean(node.data.url, 2048),
    keywords: keywords(hostOf(node.data.url)),
  }),
  validate: (node) =>
    urlIssues(node.data.url, 'The URL').map((issue) => ({
      ...issue,
      field: 'data.url',
      severity: 'error' as const,
    })),
  capture: {
    // Loses to `website` on a plain paste; wins when the payload is explicitly opted out.
    match: (input) => (input.kind === 'url' ? 0.4 : 0),
    build: (input) => ({ title: hostOf(input.text ?? ''), data: { url: input.text ?? '' } }),
  },
  io: {
    ...jsonIo(LinkDataSchema),
    toMarkdown: (node) =>
      `[${node.data.label ?? (node.title !== '' ? node.title : hostOf(node.data.url))}](${node.data.url})`,
  },
});
