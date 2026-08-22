/** The github output parser (11_GITHUB.md §7): repo, owner, homepage and contributors. */

import { describe, expect, it } from 'vitest';

import { parser } from '../github/parser.ts';
import { declarativeParser } from '../src/declarativeParser.ts';
import { IntegrationError } from '../src/errors.ts';
import type { ArtifactRef, ParseContext, RawRunResult } from '../src/pipeline.ts';

const ref = (name: string, over: Partial<ArtifactRef> = {}): ArtifactRef => ({
  bucket: 'runs',
  key: `org/run-1/${name}`,
  bytes: 10,
  sha256: 'x',
  contentType: 'application/json',
  truncated: false,
  ...over,
});

const result = (artifacts: readonly ArtifactRef[]): RawRunResult =>
  ({
    runId: 'run-1',
    status: 'succeeded',
    exitCode: 0,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:03.000Z',
    durationMs: 3000,
    artifacts,
    stats: { bytesOut: 10, egressRequests: 2, egressDenied: 0, peakMemMiB: 0 },
  }) as RawRunResult;

const context = (bodies: Record<string, string>): ParseContext =>
  ({
    manifest: {} as ParseContext['manifest'],
    runId: 'run-1',
    input: {},
    readArtifact: (artifact: ArtifactRef) =>
      Promise.resolve(
        (async function* stream() {
          yield new TextEncoder().encode(bodies[artifact.key.split('/').pop() ?? ''] ?? '');
        })(),
      ),
    logger: { log: () => undefined },
  }) as unknown as ParseContext;

const repoBody = JSON.stringify({
  html_url: 'https://github.com/acme/tool',
  full_name: 'acme/tool',
  description: 'A tool.',
  stargazers_count: 42,
  language: 'TypeScript',
  homepage: 'https://acme.dev',
  license: { spdx_id: 'MIT' },
  owner: { login: 'acme', html_url: 'https://github.com/acme', type: 'Organization' },
});

describe('github parser', () => {
  it('emits repository, owner and homepage records from the repo artifact', async () => {
    const doc = await parser.parse(result([ref('repo')]), context({ repo: repoBody }));

    expect(doc.records.map((record) => record.type)).toEqual(['repository', 'owner', 'homepage']);
    expect(doc.records[0]?.data).toMatchObject({
      htmlUrl: 'https://github.com/acme/tool',
      fullName: 'acme/tool',
      stars: 42,
      primaryLanguage: 'TypeScript',
      license: 'MIT',
    });
    expect(doc.records[1]?.data).toMatchObject({ login: 'acme', type: 'Organization' });
    expect(doc.records[0]?.observedAt).toBe('2026-01-01T00:00:03.000Z');
    expect(doc.counters['records']).toBe(3);
  });

  it('skips the homepage record when the repository has none', async () => {
    const body = JSON.stringify({ html_url: 'https://github.com/a/b', homepage: '' });
    const doc = await parser.parse(result([ref('repo')]), context({ repo: body }));

    expect(doc.records.map((record) => record.type)).toEqual(['repository']);
  });

  it('adds one record per contributor and ignores entries without a login', async () => {
    const contributors = JSON.stringify([
      { login: 'ann', html_url: 'https://github.com/ann', contributions: 12 },
      { contributions: 3 },
    ]);
    const doc = await parser.parse(
      result([ref('repo'), ref('contributors')]),
      context({ repo: repoBody, contributors }),
    );

    expect(doc.counters['contributors']).toBe(1);
    expect(doc.records.at(-1)?.data).toMatchObject({ login: 'ann', contributions: 12 });
    expect(doc.nonFatalIssues).toEqual([]);
  });

  it('reports a truncated contributor page as a non-fatal issue', async () => {
    const doc = await parser.parse(
      result([ref('repo'), ref('contributors', { truncated: true })]),
      context({ repo: repoBody, contributors: '[]' }),
    );

    expect(doc.nonFatalIssues[0]?.level).toBe('warn');
  });

  it('fails with OUTPUT_MISSING when no repo artifact was collected', async () => {
    await expect(parser.parse(result([ref('readme')]), context({}))).rejects.toBeInstanceOf(
      IntegrationError,
    );
  });

  it('fails with PARSE_UNSUPPORTED_SHAPE on unusable json', async () => {
    await expect(
      parser.parse(result([ref('repo')]), context({ repo: '{"nope":1}' })),
    ).rejects.toMatchObject({ code: 'PARSE_UNSUPPORTED_SHAPE' });
    await expect(
      parser.parse(result([ref('repo')]), context({ repo: 'not json' })),
    ).rejects.toMatchObject({ code: 'PARSE_UNSUPPORTED_SHAPE' });
  });
});

describe('declarative parser', () => {
  it('types records after the artifact name and expands arrays', async () => {
    const doc = await declarativeParser.parse(
      result([ref('finding.json')]),
      context({ 'finding.json': JSON.stringify([{ a: 1 }, { a: 2 }, 'skip']) }),
    );

    expect(doc.records).toHaveLength(2);
    expect(doc.records[0]).toMatchObject({ type: 'finding', pointer: '/0', data: { a: 1 } });
  });

  it('emits a single record for an object artifact', async () => {
    const doc = await declarativeParser.parse(
      result([ref('summary')]),
      context({ summary: '{"total":3}' }),
    );

    expect(doc.records).toEqual([
      expect.objectContaining({ type: 'summary', pointer: '/', data: { total: 3 } }),
    ]);
  });

  it('fails when the run produced nothing', async () => {
    await expect(declarativeParser.parse(result([]), context({}))).rejects.toBeInstanceOf(
      IntegrationError,
    );
  });
});
