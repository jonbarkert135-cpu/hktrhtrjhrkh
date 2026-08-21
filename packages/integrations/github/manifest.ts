/**
 * The `github` integration manifest (11_GITHUB.md, 10_INTEGRATIONS.md §4).
 *
 * GitHub is HTTP-only (§1's execution table): no container image, no `git clone`, so this declares
 * `execution.kind: 'http'` and the runner's http executor performs the fetches. Exactly two hosts
 * are reachable — `api.github.com` and `raw.githubusercontent.com` — and they are declared *here*,
 * per manifest, rather than in any global allowlist (P9 §6.4, 15_SECURITY.md §6).
 */

import { parseManifest, type IntegrationManifest, type NetworkPolicy } from '../src/manifest.ts';

export const GITHUB_ID = 'github';

export const GITHUB_API_HOST = 'api.github.com';
export const GITHUB_RAW_HOST = 'raw.githubusercontent.com';

/** §8.2's hard rules: 10 concurrent per credential, and a ceiling that protects the shared IP. */
const network: NetworkPolicy = {
  mode: 'allowlist',
  allow: [GITHUB_API_HOST, GITHUB_RAW_HOST],
  denyPrivateRanges: true,
  maxRequestsPerMinute: 300,
  maxConcurrentConnections: 10,
};

const accept = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };

/**
 * The analysis fetch set (§5, §8.4). Anonymous runs are budget-capped by the adapter, not by
 * dropping requests here — the manifest describes what a *full* analysis reads.
 */
const requests = [
  { name: 'repo', path: '/repos/{owner}/{repo}', collectAs: 'repo' },
  { name: 'readme', path: '/repos/{owner}/{repo}/readme', collectAs: 'readme' },
  { name: 'languages', path: '/repos/{owner}/{repo}/languages', collectAs: 'languages' },
  { name: 'license', path: '/repos/{owner}/{repo}/license', collectAs: 'license' },
  {
    name: 'releases',
    path: '/repos/{owner}/{repo}/releases',
    query: { per_page: '20' },
    collectAs: 'releases',
  },
  {
    name: 'contributors',
    path: '/repos/{owner}/{repo}/contributors',
    query: { per_page: '30', anon: '0' },
    collectAs: 'contributors',
  },
  {
    name: 'issues',
    path: '/repos/{owner}/{repo}/issues',
    query: { per_page: '30', state: 'open' },
    collectAs: 'issues',
  },
].map((request) => ({
  ...request,
  method: 'GET' as const,
  headers: accept,
  // Every list endpoint pages with the Link header; the adapter stops at the budget long before.
  paginate: { style: 'link-header' as const, maxPages: 5 },
}));

export const manifest: IntegrationManifest = parseManifest({
  manifestVersion: 1,
  id: GITHUB_ID,
  name: 'GitHub',
  version: '1.0.0',
  toolVersion: '2022-11-28',
  publisher: { name: 'Raven core', url: 'https://raven.local', verified: true },
  icon: 'integrations/github',
  repository: 'https://github.com/raven/raven',
  license: 'Apache-2.0',
  description:
    'Reads a public GitHub repository — metadata, README, releases, contributors, languages and license — and proposes the repository, its owner and its top contributors as nodes on the board.',
  documentationUrl: 'https://docs.github.com/rest',
  capabilities: ['fetch-repo', 'enrich-entity'],
  inputs: [
    {
      name: 'url',
      label: 'Repository URL',
      type: 'string',
      required: true,
      help: 'A github.com repository URL. Only public repositories are read in anonymous mode.',
      pattern: '^https?://(www\\.)?github\\.com/[^/\\s]+/[^/\\s]+',
      from: { source: 'selection', kinds: ['url'] },
    },
    {
      name: 'includeContributors',
      label: 'Propose contributors as people',
      type: 'boolean',
      required: false,
      default: true,
      help: 'Contributors above the threshold become person candidates in the proposal.',
    },
    {
      name: 'minContributions',
      label: 'Minimum contributions',
      type: 'number',
      required: false,
      default: 5,
      min: 1,
      max: 1000,
      advanced: true,
    },
  ],
  outputs: [
    { name: 'analysis', kind: 'json', fromStdout: true, primary: true, maxBytes: 4_194_304 },
  ],
  permissions: ['net:allowlist', 'graph:read', 'graph:propose'],
  execution: {
    kind: 'http',
    baseUrl: `https://${GITHUB_API_HOST}`,
    requests,
    network,
    limits: {
      wallClockMs: 60_000,
      cpuMillicores: 500,
      memoryMiB: 256,
      pids: 16,
      tmpfsMiB: 16,
      maxOutputBytes: 4_194_304,
      maxArtifacts: 1,
    },
  },
  parser: {
    module: '@nexus/integrations/github/parser',
    export: 'parser',
    supportedOutputVersions: ['1.0'],
  },
  entityMappings: [
    {
      id: 'repository',
      when: { recordType: 'repository' },
      entity: {
        kind: 'url',
        valueFrom: '/htmlUrl',
        nodeType: 'link',
        titleFrom: '/fullName',
        fields: [
          { from: '/htmlUrl', to: 'url', transform: 'url-normalize', required: true },
          { from: '/description', to: 'description' },
          { from: '/stars', to: 'stars' },
          { from: '/primaryLanguage', to: 'language' },
          { from: '/license', to: 'license' },
        ],
        tags: ['github', 'repository'],
        baseConfidence: 0.95,
      },
      relate: [{ to: 'anchor', edgeType: 'related_to', direction: 'out', label: 'repository' }],
    },
    {
      id: 'owner',
      when: { recordType: 'owner' },
      entity: {
        kind: 'username',
        valueFrom: '/login',
        nodeType: 'person',
        titleFrom: '/login',
        fields: [
          { from: '/login', to: 'username', required: true },
          { from: '/htmlUrl', to: 'url', transform: 'url-normalize' },
          { from: '/type', to: 'ownerType' },
        ],
        tags: ['github', 'owner'],
        baseConfidence: 0.9,
      },
      relate: [{ to: 'anchor', edgeType: 'related_to', direction: 'in', label: 'owns' }],
    },
    {
      id: 'contributor',
      when: { recordType: 'contributor' },
      entity: {
        kind: 'username',
        valueFrom: '/login',
        nodeType: 'person',
        titleFrom: '/login',
        fields: [
          { from: '/login', to: 'username', required: true },
          { from: '/htmlUrl', to: 'url', transform: 'url-normalize' },
          { from: '/contributions', to: 'contributions' },
        ],
        tags: ['github', 'contributor'],
        baseConfidence: 0.75,
      },
      relate: [{ to: 'anchor', edgeType: 'related_to', direction: 'in', label: 'contributed to' }],
    },
    {
      id: 'homepage',
      when: { recordType: 'homepage' },
      entity: {
        kind: 'url',
        valueFrom: '/url',
        nodeType: 'link',
        titleFrom: '/url',
        fields: [{ from: '/url', to: 'url', transform: 'url-normalize', required: true }],
        tags: ['github', 'homepage'],
        baseConfidence: 0.6,
      },
      relate: [{ to: 'anchor', edgeType: 'related_to', direction: 'out', label: 'homepage' }],
    },
  ],
  rateLimits: {
    perUserPerHour: 60,
    perOrgPerHour: 300,
    perTargetPerDay: 24,
    concurrentRunsPerOrg: 3,
    minIntervalMsSameInput: 60_000,
  },
  costHints: {
    typicalDurationMs: 3_000,
    typicalOutboundRequests: 7,
    typicalNewNodes: 12,
    billable: false,
  },
  maturity: 'beta',
  risk: {
    label: 'low',
    reasons: [
      'Reads public GitHub data over HTTPS from api.github.com and raw.githubusercontent.com only.',
      'Read-only: no write scope is ever requested and no repository is cloned.',
    ],
    upstreamMaintenance: 'active',
    fallback:
      'If GitHub is unreachable or the quota is exhausted the run ends partial or failed; nothing is imported and cached node data is left untouched.',
  },
  consent: {
    required: true,
    scopeText:
      'I confirm I may look up this repository. Analysing it sends read-only requests to api.github.com and raw.githubusercontent.com for public repository data; nothing else leaves this deployment and nothing is written to GitHub.',
    allowedTargetScopes: ['public-index'],
  },
});
