/** The conformance harness itself: it is the gate every tool PR leans on, so it is tested (§13). */

import { describe, expect, it } from 'vitest';

import { manifest as expandUrl } from '../builtin/manifest.ts';
import { parser as expandUrlParser } from '../builtin/parser.ts';
import {
  assertManifestConforms,
  checkManifestConformance,
  fakeArtifactRef,
  fakeRunResult,
  memoryLogger,
  memoryParseContext,
  parseFixture,
} from '../src/testkit/harness.ts';
import { parseManifest } from '../src/manifest.ts';

const valid = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(expandUrl)) as Record<string, unknown>;

const rules = (raw: Record<string, unknown>, options = {}): string[] =>
  checkManifestConformance(raw, options).map((issue) => issue.rule);

describe('checkManifestConformance', () => {
  it('passes the shipped manifest', () => {
    expect(checkManifestConformance(valid())).toEqual([]);
  });

  it('reports schema issues with their path and stops there', () => {
    const issues = checkManifestConformance({ id: 'nope' });
    expect(issues.every((issue) => issue.rule === 'schema')).toBe(true);
    expect(issues[0]?.message).toMatch(/.+:/);
  });

  it('leaves the schema-enforced rules to the schema', () => {
    const raw = valid();
    (raw.consent as Record<string, unknown>).scopeText = 'too short';
    expect(rules(raw)).toEqual(['schema']);
  });

  it('checks mapped node and edge types against the registries it is given', () => {
    const found = rules(valid(), { knownNodeTypes: new Set(), knownEdgeTypes: new Set() });
    expect(found).toContain('node-type-exists');
    expect(found).toContain('edge-type-exists');
  });
});

describe('assertManifestConforms', () => {
  it('returns the parsed manifest when everything conforms', () => {
    expect(assertManifestConforms(valid()).id).toBe(expandUrl.id);
  });

  it('throws one error listing every violation', () => {
    expect(() => assertManifestConforms(valid(), { knownNodeTypes: new Set() })).toThrow(
      /manifest does not conform:[\s\S]*node-type-exists/,
    );
  });
});

describe('fixtures', () => {
  it('memoryLogger collects level, phase and message', () => {
    const logger = memoryLogger();
    logger.log({ level: 'warn', phase: 'parse', message: 'careful' });
    expect(logger.lines).toEqual(['warn parse careful']);
  });

  it('fakeArtifactRef and fakeRunResult apply overrides over sane defaults', () => {
    expect(fakeArtifactRef({ bytes: 12 })).toMatchObject({ bucket: 'test', bytes: 12 });
    const result = fakeRunResult({ status: 'failed', exitCode: 1 });
    expect(result).toMatchObject({ runId: 'run-test', status: 'failed', exitCode: 1 });
    expect(result.artifacts).toHaveLength(1);
  });

  it('memoryParseContext streams the fixture bytes back without touching S3', async () => {
    const context = memoryParseContext(parseManifest(valid()), 'hello');
    const chunks: Uint8Array[] = [];
    for await (const chunk of await context.readArtifact(fakeArtifactRef())) chunks.push(chunk);
    expect(new TextDecoder().decode(chunks[0])).toBe('hello');
    expect(context.runId).toBe('run-test');
  });
});

describe('parseFixture', () => {
  it('drives a parser over a fixture string and returns its document', async () => {
    const manifest = parseManifest(valid());
    const doc = await parseFixture(
      expandUrlParser,
      manifest,
      JSON.stringify({
        version: '1.0',
        inputUrl: 'https://sho.rt/x',
        finalUrl: 'https://example.com/',
        hops: 1,
        status: 200,
        chain: ['https://sho.rt/x', 'https://example.com/'],
        observedAt: '2026-02-01T00:00:00.000Z',
      }),
    );
    expect(doc.toolReportedVersion).toBe('1.0');
    expect(doc.records).toHaveLength(1);
  });
});
