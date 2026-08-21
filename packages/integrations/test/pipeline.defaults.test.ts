/** Default pipeline stage implementations: adapter, extractor, mappers, proposal, helpers. */

import { describe, expect, it } from 'vitest';

import { manifest as expandUrl } from '../builtin/manifest.ts';
import { parser as expandUrlParser } from '../builtin/parser.ts';
import {
  buildProposal,
  defaultNodeMapper,
  defaultRelationshipMapper,
  effectiveLimits,
  jsonPointer,
  manifestEntityExtractor,
  manifestInputAdapter,
  runParsePipeline,
  versionDrift,
  type ExtractionResult,
  type IntegrationInvocation,
  type MapContext,
  type ParsedDocument,
  type Provenance,
} from '../src/pipeline.ts';
import { limitsOf, networkPolicyOf, parseManifest } from '../src/manifest.ts';
import { fakeRunResult, memoryParseContext } from '../src/testkit/index.ts';

const NOW = '2026-02-01T00:00:00.000Z';

const provenanceFor = (origin: { pointer: string }, confidence: number): Provenance => ({
  source: 'test',
  tool: expandUrl.id,
  toolVersion: expandUrl.version,
  runId: 'run-1',
  observedAt: NOW,
  importedAt: NOW,
  confidence,
  pointer: origin.pointer,
  actorUserId: 'user-1',
});

const invocation = (over: Partial<IntegrationInvocation> = {}): IntegrationInvocation => ({
  integrationId: expandUrl.id,
  boardId: 'board-1',
  selection: [],
  formValues: {},
  actorUserId: 'user-1',
  ...over,
});

function documentOf(finalUrl: string, parserConfidence = 1): ParsedDocument {
  return {
    toolReportedVersion: '1.0',
    records: [
      {
        type: 'expanded_url',
        data: { finalUrl, inputUrl: 'https://sho.rt/x', hops: 2, status: 200 },
        pointer: '/finalUrl',
        observedAt: NOW,
        parserConfidence,
      },
    ],
    counters: {},
    nonFatalIssues: [],
  };
}

describe('jsonPointer', () => {
  it('resolves object, array and escaped segments', () => {
    const data = { 'a/b': { list: [1, { 'c~d': 'x' }] } };
    expect(jsonPointer(data, '')).toBe(data);
    expect(jsonPointer(data, '/')).toBe(data);
    expect(jsonPointer(data, '/a~1b/list/0')).toBe(1);
    expect(jsonPointer(data, '/a~1b/list/1/c~0d')).toBe('x');
  });

  it('returns undefined for bad indexes and non-objects', () => {
    expect(jsonPointer({ list: [1] }, '/list/nope')).toBeUndefined();
    expect(jsonPointer({ a: 'string' }, '/a/b')).toBeUndefined();
    expect(jsonPointer(null, '/a')).toBeUndefined();
  });
});

describe('manifestInputAdapter', () => {
  const adapter = manifestInputAdapter(expandUrl);

  it('accepts only selections carrying a declared kind', () => {
    expect(adapter.accepts([])).toBe(false);
    expect(adapter.accepts([{ id: 'n1', kind: 'url', label: 'https://sho.rt/x', props: {} }])).toBe(
      true,
    );
    expect(adapter.accepts([{ id: 'n1', kind: 'domain', label: 'example.test', props: {} }])).toBe(
      false,
    );
  });

  it('reads from the selection and resolves a target', () => {
    const out = adapter.adapt(
      invocation({ selection: [{ id: 'n1', kind: 'url', label: 'https://sho.rt/x', props: {} }] }),
    );
    expect(out.input.url).toBe('https://sho.rt/x');
    expect(out.targets).toEqual([
      { kind: 'url', value: 'https://sho.rt/x', scope: 'public-index' },
    ]);
    expect(out.warnings).toEqual([]);
  });

  it('falls back to form values when the selection has no match', () => {
    const out = adapter.adapt(invocation({ formValues: { url: 'https://sho.rt/y' } }));
    expect(out.input.url).toBe('https://sho.rt/y');
  });

  it('throws INPUT_INVALID for a missing required field', () => {
    expect(() => adapter.adapt(invocation())).toThrow(/INPUT_INVALID/);
  });

  it('throws INPUT_INVALID when the pattern does not match', () => {
    expect(() => adapter.adapt(invocation({ formValues: { url: 'ftp://nope' } }))).toThrow(
      /INPUT_INVALID/,
    );
  });

  it('accepts an adapter with no selection-sourced inputs', () => {
    const bare = manifestInputAdapter(withInputs([]));
    expect(bare.accepts([])).toBe(true);
    expect(bare.adapt(invocation())).toEqual({ input: {}, targets: [], warnings: [] });
  });

  it('coerces, defaults, bounds-checks and warns when nothing resolves', () => {
    const m = withInputs([
      {
        name: 'count',
        label: 'Count',
        type: 'number',
        required: false,
        default: 3,
        min: 1,
        max: 5,
      },
      { name: 'deep', label: 'Deep', type: 'boolean', required: false },
      { name: 'note', label: 'Note', type: 'string', required: false },
    ]);
    const out = manifestInputAdapter(m).adapt(
      invocation({ formValues: { deep: 'true', note: '  hi  ' } }),
    );
    expect(out.input).toEqual({ count: 3, deep: true, note: 'hi' });
    expect(out.warnings[0]?.level).toBe('info');
  });

  it('rejects out-of-range numbers, non-numbers and oversized lists', () => {
    const numeric = manifestInputAdapter(
      withInputs([
        { name: 'count', label: 'Count', type: 'number', required: false, min: 2, max: 4 },
      ]),
    );
    expect(() => numeric.adapt(invocation({ formValues: { count: 1 } }))).toThrow(/at least 2/);
    expect(() => numeric.adapt(invocation({ formValues: { count: 9 } }))).toThrow(/at most 4/);
    expect(() => numeric.adapt(invocation({ formValues: { count: 'abc' } }))).toThrow(
      /must be a number/,
    );

    const list = manifestInputAdapter(
      withInputs([
        {
          name: 'hosts',
          label: 'Hosts',
          type: 'entityList',
          required: false,
          maxItems: 1,
          entityKinds: ['domain'],
        },
      ]),
    );
    expect(() => list.adapt(invocation({ formValues: { hosts: ['a.test', 'b.test'] } }))).toThrow(
      /at most 1 values/,
    );
    const single = list.adapt(invocation({ formValues: { hosts: 'a.test' } }));
    expect(single.input.hosts).toEqual(['a.test']);
    expect(single.targets[0]?.kind).toBe('domain');
  });

  it('supports domainOf() derived inputs and refuses anything else', () => {
    const derived = manifestInputAdapter(
      withInputs([
        {
          name: 'host',
          label: 'Host',
          type: 'string',
          required: false,
          from: { source: 'derived', expr: 'domainOf(url)' },
        },
      ]),
    );
    expect(
      derived.adapt(invocation({ formValues: { url: 'https://a.example.test/x' } })).input,
    ).toEqual({ host: 'a.example.test' });
    // no source value at all → field simply absent
    expect(derived.adapt(invocation()).input).toEqual({});
    // an unparseable URL yields no host either
    expect(derived.adapt(invocation({ formValues: { url: 'not a url' } })).input).toEqual({});

    const bad = manifestInputAdapter(
      withInputs([
        {
          name: 'host',
          label: 'Host',
          type: 'string',
          required: false,
          from: { source: 'derived', expr: 'evil(1)' },
        },
      ]),
    );
    expect(() => bad.adapt(invocation({ formValues: {} }))).toThrow(/MANIFEST_TEMPLATE_UNRESOLVED/);
  });
});

describe('manifestEntityExtractor', () => {
  it('extracts an entity plus its anchor relation', () => {
    const result = manifestEntityExtractor(expandUrl).extract(
      documentOf('https://a.example.test/p'),
      { manifest: expandUrl, anchorKey: 'url:https://sho.rt/x', drift: 'exact' },
    );
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.nodeType).toBe('link');
    expect(result.entities[0]?.props).toMatchObject({ redirectHops: 2, httpStatus: 200 });
    expect(result.relations).toEqual([
      {
        fromKey: result.entities[0]?.identityKey,
        toKey: 'url:https://sho.rt/x',
        type: 'related_to',
        label: 'expands to',
        confidence: result.entities[0]?.confidence,
        origin: { recordIndex: 0, pointer: '/finalUrl' },
      },
    ]);
  });

  it('warns when the relation target cannot be resolved', () => {
    const result = manifestEntityExtractor(expandUrl).extract(
      documentOf('https://a.example.test/p'),
      { manifest: expandUrl },
    );
    expect(result.relations).toEqual([]);
    expect(result.issues.some((i) => /relation target/.test(i.message))).toBe(true);
  });

  it('warns and skips on empty and unnormalizable identity values', () => {
    const extractor = manifestEntityExtractor(expandUrl);
    const empty = extractor.extract(documentOf('   '), { manifest: expandUrl });
    expect(empty.entities).toEqual([]);
    expect(empty.issues.some((i) => /empty identity value/.test(i.message))).toBe(true);

    const bad = extractor.extract(documentOf('mailto:nope'), { manifest: expandUrl });
    expect(bad.entities).toEqual([]);
    expect(bad.issues.length).toBeGreaterThan(0);
  });

  it('ignores records no mapping matches', () => {
    const result = manifestEntityExtractor(expandUrl).extract(
      {
        records: [
          {
            type: 'other',
            data: {},
            pointer: '/x',
            observedAt: NOW,
            parserConfidence: 1,
          },
        ],
        counters: {},
        nonFatalIssues: [{ level: 'info', message: 'carried through' }],
      },
      { manifest: expandUrl },
    );
    expect(result.entities).toEqual([]);
    expect(result.issues).toEqual([{ level: 'info', message: 'carried through' }]);
  });

  it('skips an entity whose required field is missing and applies transforms', () => {
    const m = withMappings([
      {
        id: 'm1',
        when: { recordType: 'r' },
        entity: {
          kind: 'domain',
          valueFrom: '/host',
          nodeType: 'link',
          fields: [
            { from: '/must', to: 'must', required: true },
            { from: '/handle', to: 'handle', transform: 'strip-at' },
            { from: '/loud', to: 'loud', transform: 'lower' },
            { from: '/pad', to: 'pad', transform: 'trim' },
            { from: '/link', to: 'link', transform: 'url-normalize' },
            { from: '/link', to: 'host', transform: 'domain-of' },
            { from: '/hash', to: 'hash', transform: 'sha256' },
          ],
          tags: [],
          baseConfidence: 0.9,
        },
        relate: [],
      },
    ]);
    const record = (data: Record<string, unknown>) => ({
      records: [{ type: 'r', data, pointer: '/0', observedAt: NOW, parserConfidence: 1 }],
      counters: {},
      nonFatalIssues: [],
    });

    const missing = manifestEntityExtractor(m).extract(record({ host: 'a.test' }), {
      manifest: m,
    });
    expect(missing.entities).toEqual([]);
    expect(missing.issues.some((i) => /required field/.test(i.message))).toBe(true);

    const ok = manifestEntityExtractor(m).extract(
      record({
        host: 'A.test',
        must: 1,
        handle: '@bob',
        loud: 'ABC',
        pad: ' x ',
        link: 'https://B.test/p',
        hash: 'raw',
      }),
      { manifest: m, defaultRegion: 'US' },
    );
    expect(ok.entities[0]?.props).toEqual({
      must: 1,
      handle: 'bob',
      loud: 'abc',
      pad: 'x',
      link: 'https://b.test/p',
      host: 'b.test',
      hash: 'raw',
    });
    expect(ok.entities[0]?.title).toBe('A.test');
    expect(ok.entities[0]?.value).toBe('a.test');
  });
});

describe('mappers and buildProposal', () => {
  const extraction = (): ExtractionResult =>
    manifestEntityExtractor(expandUrl).extract(documentOf('https://a.example.test/p'), {
      manifest: expandUrl,
      anchorKey: 'url:https://anchor.test/',
    });

  it('maps new nodes and drops relations with an unknown endpoint', () => {
    const ctx: MapContext = { boardId: 'b', resolve: () => undefined, provenanceFor };
    const e = extraction();
    const nodes = defaultNodeMapper().map(e, ctx);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.layoutHint).toEqual({ ring: 1, index: 0 });
    expect(defaultRelationshipMapper().map(e, nodes, ctx)).toEqual([]);
  });

  it('uses an existing node for the anchor endpoint and skips duplicates', () => {
    const ctx: MapContext = {
      boardId: 'b',
      anchorNodeId: 'anchor-node',
      resolve: (key) =>
        key === 'url:https://anchor.test/'
          ? { nodeId: 'anchor-node', kind: 'url', title: 'anchor', props: {}, boardId: 'b' }
          : undefined,
      provenanceFor,
    };
    const e = extraction();
    const doubled: ExtractionResult = {
      ...e,
      entities: [...e.entities, ...e.entities],
    };
    const nodes = defaultNodeMapper().map(doubled, ctx);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.layoutHint?.anchorNodeId).toBe('anchor-node');
    const edges = defaultRelationshipMapper().map(e, nodes, ctx);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.toRef).toEqual({ kind: 'existing', nodeId: 'anchor-node' });
    expect(edges[0]?.fromRef.kind).toBe('temp');
  });

  it('produces enrich, conflict and skipped-duplicate items for existing identities', () => {
    const e = manifestEntityExtractor(expandUrl).extract(documentOf('https://a.example.test/p'), {
      manifest: expandUrl,
    });
    const key = e.entities[0]?.identityKey ?? '';
    const ctx: MapContext = {
      boardId: 'b',
      resolve: (k) =>
        k === key
          ? {
              nodeId: 'node-1',
              kind: 'url',
              boardId: 'b',
              title: 'existing',
              // same url (skip), different status (conflict), missing hops (enrich)
              props: { url: 'https://a.example.test/p', httpStatus: 404 },
              confidence: 0.99,
            }
          : undefined,
      provenanceFor,
    };
    const proposal = buildProposal({
      proposalId: 'p1',
      runId: 'run-1',
      integrationId: expandUrl.id,
      boardId: 'b',
      now: NOW,
      extraction: e,
      nodes: [],
      edges: [],
      ctx,
    });
    expect(proposal.summary.newNodes).toBe(0);
    expect(proposal.summary.enriched).toBe(1);
    expect(proposal.summary.conflicts).toBe(1);
    expect(proposal.summary.skippedDuplicates).toBe(1);
    expect(Date.parse(proposal.expiresAt)).toBeGreaterThan(Date.parse(NOW));
    const conflict = proposal.items.find((i) => i.kind === 'conflict');
    expect(conflict?.id).toBe('c:node-1:httpStatus');
  });

  it('deselects an edge whose endpoint node is not selected by default', () => {
    const e = manifestEntityExtractor(expandUrl).extract(
      documentOf('https://a.example.test/p', 0.1),
      {
        manifest: expandUrl,
        anchorKey: 'url:https://anchor.test/',
      },
    );
    const ctx: MapContext = {
      boardId: 'b',
      resolve: (key) =>
        key === 'url:https://anchor.test/'
          ? { nodeId: 'anchor-node', kind: 'url', title: 'a', props: {}, boardId: 'b' }
          : undefined,
      provenanceFor,
    };
    const nodes = defaultNodeMapper().map(e, ctx);
    const edges = defaultRelationshipMapper().map(e, nodes, ctx);
    const proposal = buildProposal({
      proposalId: 'p1',
      runId: 'run-1',
      integrationId: expandUrl.id,
      boardId: 'b',
      now: NOW,
      extraction: e,
      nodes,
      edges,
      ctx,
    });
    expect(proposal.items.find((i) => i.kind === 'new_node')?.selectedByDefault).toBe(false);
    expect(proposal.items.find((i) => i.kind === 'new_edge')?.selectedByDefault).toBe(false);
  });
});

describe('runParsePipeline', () => {
  it('runs stages 3–7 over a real parser artifact', async () => {
    const payload = JSON.stringify({
      version: '1.0',
      inputUrl: 'https://sho.rt/x',
      finalUrl: 'https://a.example.test/p',
      hops: 2,
      status: 200,
      chain: ['https://sho.rt/x'],
      observedAt: NOW,
    });
    const result = fakeRunResult();
    const out = await runParsePipeline({
      manifest: expandUrl,
      parser: expandUrlParser,
      result,
      parseContext: memoryParseContext(expandUrl, payload, result.runId),
      boardId: 'board-1',
      proposalId: 'p1',
      actorUserId: 'user-1',
      now: NOW,
      anchorNodeId: 'anchor-node',
      anchorKey: 'url:https://sho.rt/x',
      defaultRegion: 'US',
      resolve: (key) =>
        key === 'url:https://sho.rt/x'
          ? { nodeId: 'anchor-node', kind: 'url', title: 'anchor', props: {}, boardId: 'b' }
          : undefined,
    });
    expect(out.drift).toBe('exact');
    expect(out.document.records).toHaveLength(1);
    expect(out.proposal.summary.newNodes).toBe(1);
    expect(out.proposal.summary.newEdges).toBe(1);
    const node = out.proposal.items.find((i) => i.kind === 'new_node');
    expect(node?.kind === 'new_node' && node.node.provenance.artifactRef).toBeDefined();
  });

  it('works without an anchor or artifacts', async () => {
    const payload = JSON.stringify({
      version: '9.9',
      inputUrl: 'https://sho.rt/x',
      finalUrl: 'https://a.example.test/p',
      hops: 1,
      status: 200,
      chain: [],
      observedAt: NOW,
    });
    const result = fakeRunResult({ artifacts: [] });
    await expect(
      runParsePipeline({
        manifest: expandUrl,
        parser: expandUrlParser,
        result,
        parseContext: memoryParseContext(expandUrl, payload, result.runId),
        boardId: 'board-1',
        proposalId: 'p1',
        actorUserId: 'user-1',
        now: NOW,
        resolve: () => undefined,
      }),
    ).rejects.toThrow(/OUTPUT_MISSING/);
  });
});

describe('versionDrift and effectiveLimits', () => {
  it('classifies the four drift cases', () => {
    expect(versionDrift('1.0', ['1.0'], '1.0')).toBe('exact');
    expect(versionDrift('1.0.3', ['1.0.1'], '1.0')).toBe('patch');
    expect(versionDrift('1.4', ['1.0'], '1.0')).toBe('minor');
    expect(versionDrift('2.0', ['1.0'], '1.0')).toBe('major');
    expect(versionDrift('2.0', [], '2.1')).toBe('minor');
  });

  it('takes the minimum of manifest and policy limits and intersects the allowlist', () => {
    const limits = limitsOf(expandUrl);
    const network = networkPolicyOf(expandUrl);
    expect(network.mode).toBe('none');

    const withoutPolicy = effectiveLimits(limits, { allow: ['a.test'], maxRequestsPerMinute: 10 });
    expect(withoutPolicy.egressAllowlist).toEqual(['a.test']);
    expect(withoutPolicy.wallClockMs).toBe(limits.wallClockMs);

    const withPolicy = effectiveLimits(
      limits,
      { allow: ['a.test', 'b.test'], maxRequestsPerMinute: 10 },
      { maxWallClockMs: 1000, maxMemoryMiB: 64, networkAllow: ['b.test'] },
    );
    expect(withPolicy).toMatchObject({
      wallClockMs: 1000,
      memoryMiB: 64,
      egressAllowlist: ['b.test'],
    });
    expect(
      effectiveLimits(
        limits,
        { allow: ['a.test'], maxRequestsPerMinute: 10 },
        {
          maxWallClockMs: null,
          networkAllow: null,
        },
      ).egressAllowlist,
    ).toEqual(['a.test']);
  });
});

/* ------------------------------------------------------------------ helpers */

const BASE = JSON.parse(JSON.stringify(expandUrl)) as Record<string, unknown>;

function withInputs(inputs: readonly Record<string, unknown>[]) {
  return parseManifest({
    ...BASE,
    inputs: inputs.map((input) => ({
      from: { source: 'form' },
      ...input,
    })),
  });
}

function withMappings(entityMappings: readonly Record<string, unknown>[]) {
  return parseManifest({ ...BASE, entityMappings });
}
