/**
 * `repo` — a source-code repository (06_NODE_SYSTEM.md §4.8). `analysis` is the structured result
 * of the repository agent (roadmap §14): it is stored verbatim so the card can render it without
 * re-running the analysis, and it is never executed.
 */

import { z } from 'zod';

import { clean, defineNodeType, jsonIo, keywords, nullableText, urlIssues } from '../define.ts';
import type { NodeTypeDefinition } from '../types.ts';

export const RepoAnalysisSchema = z
  .object({
    language: nullableText(64),
    entryPoints: z.array(z.string().max(400)).max(64).default([]),
    interfaces: z.array(z.string().max(200)).max(64).default([]),
    dependencies: z.array(z.string().max(200)).max(200).default([]),
    integrationDifficulty: z.enum(['low', 'medium', 'high', 'unknown']).default('unknown'),
    summary: nullableText(4000),
    analysedAt: nullableText(40),
  })
  .passthrough();

export const RepoDataSchema = z
  .object({
    provider: z.enum(['github', 'gitlab', 'other']).default('github'),
    owner: z.string().max(200).default(''),
    name: z.string().max(200).default(''),
    url: z.string().max(2048).default(''),
    description: nullableText(1200),
    stars: z.number().int().min(0).nullable().default(null),
    language: nullableText(64),
    defaultBranch: nullableText(120),
    analysis: RepoAnalysisSchema.nullable().default(null),
  })
  .passthrough();

export type RepoData = z.infer<typeof RepoDataSchema>;

export const repoType: NodeTypeDefinition<RepoData> = defineNodeType<RepoData>({
  type: 'repo',
  label: 'Repository',
  labelPlural: 'Repositories',
  schema: RepoDataSchema,
  glyph: { colorToken: '--entity-repo-fg', icon: 'git-branch', shape: 'rounded' },
  defaults: {
    size: { w: 320, h: 168 },
    minSize: { w: 220, h: 104 },
    maxSize: { w: 720, h: 720 },
    resize: 'width',
    autoHeight: true,
    data: RepoDataSchema.parse({}),
  },
  capabilities: {
    editableText: false,
    resizable: true,
    connectable: true,
    groupable: true,
    enrichable: true,
    duplicatable: true,
    hasMedia: false,
    aiSummarizable: true,
  },
  componentId: 'node.repo',
  inspector: [
    {
      key: 'data.url',
      label: 'Repository URL',
      control: 'url',
      section: 'identity',
      required: true,
    },
    { key: 'data.owner', label: 'Owner', control: 'text', section: 'identity' },
    { key: 'data.name', label: 'Name', control: 'text', section: 'identity' },
    { key: 'data.description', label: 'Description', control: 'textarea', section: 'content' },
    { key: 'data.language', label: 'Language', control: 'text', section: 'attributes' },
    { key: 'data.defaultBranch', label: 'Default branch', control: 'text', section: 'attributes' },
    { key: 'data.stars', label: 'Stars', control: 'readonly', section: 'attributes' },
    { key: 'data.analysis', label: 'Repository analysis', control: 'json', section: 'provenance' },
  ],
  identityKeys: (node) => {
    const slug = `${node.data.owner}/${node.data.name}`.toLowerCase();
    return slug === '/' ? [] : [`repo:${node.data.provider}:${slug}`];
  },
  searchFields: (node) => ({
    title: clean(node.title !== '' ? node.title : `${node.data.owner}/${node.data.name}`, 300),
    body: clean(`${node.data.description ?? ''} ${node.data.analysis?.summary ?? ''}`),
    keywords: keywords(
      node.data.provider,
      node.data.owner,
      node.data.name,
      node.data.language,
      ...(node.data.analysis?.dependencies ?? []).slice(0, 20),
    ),
  }),
  validate: (node) =>
    urlIssues(node.data.url, 'The repository URL').map((issue) => ({
      ...issue,
      field: 'data.url',
      severity: 'error' as const,
    })),
  capture: {
    match: (input) =>
      input.kind === 'url' && /^https?:\/\/(www\.)?(github|gitlab)\.com\//i.test(input.text ?? '')
        ? 0.95
        : 0,
    build: (input) => {
      const url = input.text ?? '';
      const match = /^https?:\/\/(?:www\.)?(github|gitlab)\.com\/([^/]+)\/([^/?#]+)/i.exec(url);
      const provider =
        match?.[1]?.toLowerCase() === 'gitlab' ? ('gitlab' as const) : ('github' as const);
      const owner = match?.[2] ?? '';
      const name = (match?.[3] ?? '').replace(/\.git$/, '');
      return {
        title: owner === '' ? url : `${owner}/${name}`,
        data: { provider, owner, name, url },
      };
    },
  },
  io: {
    ...jsonIo(RepoDataSchema),
    toMarkdown: (node) => `[${node.data.owner}/${node.data.name}](${node.data.url})`,
  },
});
