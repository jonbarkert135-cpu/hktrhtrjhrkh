/**
 * `expand-url` — the one manifest that ships with the framework (10_INTEGRATIONS.md §3.3).
 *
 * It exists to prove the whole chain (manifest → runner builtin path → worker → proposal → apply →
 * undo) before any third-party tool exists, and it is genuinely useful: pasted links are usually
 * shorteners or tracker-wrapped redirects, and the board wants the destination.
 *
 * `execution.kind: 'builtin'` means it runs in the runner process without a container, through the
 * same job protocol, timeout and cancellation path as everything else (N5).
 */

import { parseManifest, type IntegrationManifest } from '../src/manifest.ts';

export const EXPAND_URL_ID = 'expand-url';

export const manifest: IntegrationManifest = parseManifest({
  manifestVersion: 1,
  id: EXPAND_URL_ID,
  name: 'Expand URL',
  version: '1.0.0',
  toolVersion: '1.0.0',
  publisher: { name: 'Raven core', url: 'https://raven.local', verified: true },
  icon: 'integrations/expand-url',
  repository: 'https://github.com/raven/raven',
  license: 'Apache-2.0',
  description:
    'Follows redirects on a shortened or tracker-wrapped URL and proposes the canonical destination for the node, with the full redirect chain as provenance.',
  capabilities: ['enrich-entity'],
  inputs: [
    {
      name: 'url',
      label: 'URL',
      type: 'string',
      required: true,
      help: 'The link to expand. Only http and https are followed.',
      pattern: '^https?://[^\\s]{3,2000}$',
      from: { source: 'selection', kinds: ['url'] },
    },
  ],
  outputs: [{ name: 'result', kind: 'json', fromStdout: true, primary: true, maxBytes: 65_536 }],
  permissions: ['graph:read', 'graph:propose', 'net:allowlist'],
  execution: {
    kind: 'builtin',
    module: 'expand-url',
    limits: {
      wallClockMs: 30_000,
      cpuMillicores: 500,
      memoryMiB: 128,
      pids: 16,
      tmpfsMiB: 16,
      maxOutputBytes: 65_536,
      maxArtifacts: 1,
    },
  },
  parser: {
    module: '@nexus/integrations/builtin/parser',
    export: 'parser',
    supportedOutputVersions: ['1.0'],
  },
  entityMappings: [
    {
      id: 'expanded',
      when: { recordType: 'expanded_url' },
      entity: {
        kind: 'url',
        valueFrom: '/finalUrl',
        nodeType: 'link',
        titleFrom: '/finalUrl',
        fields: [
          { from: '/finalUrl', to: 'url', transform: 'url-normalize', required: true },
          { from: '/hops', to: 'redirectHops' },
          { from: '/status', to: 'httpStatus' },
        ],
        tags: ['link-expand'],
        baseConfidence: 0.95,
      },
      relate: [{ to: 'anchor', edgeType: 'related_to', direction: 'out', label: 'expands to' }],
    },
  ],
  rateLimits: {
    perUserPerHour: 120,
    perOrgPerHour: 600,
    perTargetPerDay: 60,
    concurrentRunsPerOrg: 5,
    minIntervalMsSameInput: 10_000,
  },
  costHints: {
    typicalDurationMs: 1_200,
    typicalOutboundRequests: 3,
    typicalNewNodes: 1,
    billable: false,
  },
  maturity: 'stable',
  risk: {
    label: 'low',
    reasons: ['Sends one HEAD/GET request per redirect hop to the host in the link.'],
    upstreamMaintenance: 'active',
    fallback:
      'If the destination is unreachable the run fails with UPSTREAM_UNAVAILABLE; nothing is imported.',
  },
  consent: {
    required: true,
    scopeText:
      'I confirm I may request this URL. Expanding it sends an HTTP request to the link’s host and to every host it redirects to; nothing else leaves this deployment.',
    allowedTargetScopes: ['public-index'],
  },
});
