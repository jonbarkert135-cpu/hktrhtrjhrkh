import { describe, expect, it } from 'vitest';

import { BudgetExhausted, GithubClient, type HttpResponse } from '../github/client.ts';
import { collectAnalysisInputs, selectKeyFiles } from '../github/analysis/collect.ts';
import { analyzeRepository } from '../github/analysis/analyze.ts';
import { GithubError } from '../github/errors.ts';

const NOW = Date.UTC(2026, 0, 1);

function headers(map: Record<string, string>): (name: string) => string | null {
  return (name) => map[name.toLowerCase()] ?? null;
}

function respond(status: number, body: string, extra: Record<string, string> = {}): HttpResponse {
  return { status, body, headers: headers(extra) };
}

/** A mock GitHub: routes by URL substring, records every call. */
function mockHttp(routes: Record<string, HttpResponse>, calls: string[] = []) {
  return {
    calls,
    http: (url: string): Promise<HttpResponse> => {
      calls.push(url);
      const key = Object.keys(routes).find((candidate) => url.includes(candidate));
      return Promise.resolve(key === undefined ? respond(404, '{}') : routes[key]!);
    },
  };
}

describe('GithubClient', () => {
  it('counts requests and stops at the anonymous cap without failing', async () => {
    const { http } = mockHttp({ '/repos/': respond(200, '{"ok":true}') });
    const client = new GithubClient({ http, nowMs: NOW, maxRequests: 2 });

    await client.json('/repos/a/b');
    await client.json('/repos/a/b');
    expect(client.requestsUsed).toBe(2);
    expect(client.remainingRequests).toBe(0);
    await expect(client.json('/repos/a/b')).rejects.toBeInstanceOf(BudgetExhausted);
  });

  it('adopts the budget GitHub reports and refuses when it is exhausted', async () => {
    const { http } = mockHttp({
      '/repos/': respond(200, '{}', {
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '99999',
      }),
    });
    const client = new GithubClient({ http, nowMs: NOW });
    await client.json('/repos/a/b');
    expect(client.rateBudget.remaining).toBe(0);
    await expect(client.json('/repos/a/b')).rejects.toMatchObject({ reason: 'rate_limited' });
  });

  it('maps a secondary rate limit onto its own error code', async () => {
    const { http } = mockHttp({ '/repos/': respond(403, '{}', { 'retry-after': '30' }) });
    const client = new GithubClient({ http, nowMs: NOW });
    await expect(client.json('/repos/a/b')).rejects.toMatchObject({ code: 'GH_RATE_SECONDARY' });
  });

  it('returns null for 404 and throws GH_PARSE on malformed JSON', async () => {
    const { http } = mockHttp({ '/repos/a/b': respond(200, 'not json') });
    const client = new GithubClient({ http, nowMs: NOW });
    expect(await client.json('/repos/missing/repo')).toBeNull();
    await expect(client.json('/repos/a/b')).rejects.toBeInstanceOf(GithubError);
  });

  it('sends the token only when one is configured and pins raw files to the commit', async () => {
    const seen: Record<string, string>[] = [];
    const client = new GithubClient({
      http: (_url, requestHeaders) => {
        seen.push({ ...requestHeaders });
        return Promise.resolve(respond(200, 'x'));
      },
      token: 'tok',
      nowMs: NOW,
    });
    await client.raw('a/b', 'deadbeef', 'package.json');
    expect(seen[0]?.['authorization']).toBe('Bearer tok');

    const anon = new GithubClient({
      http: (url) => Promise.resolve(respond(200, url)),
      nowMs: NOW,
    });
    expect(await anon.raw('a/b', 'deadbeef', 'go.mod')).toBe(
      'https://raw.githubusercontent.com/a/b/deadbeef/go.mod',
    );
  });

  it('drops a raw file that exceeds the size cap', async () => {
    const client = new GithubClient({
      http: () => Promise.resolve(respond(200, 'x'.repeat(20))),
      nowMs: NOW,
    });
    expect(await client.raw('a/b', 'sha', 'big.txt', 10)).toBeNull();
  });

  it('wraps a transport failure as GH_NETWORK', async () => {
    const client = new GithubClient({
      http: () => Promise.reject(new Error('socket')),
      nowMs: NOW,
    });
    await expect(client.json('/repos/a/b')).rejects.toMatchObject({ code: 'GH_NETWORK' });
  });
});

describe('selectKeyFiles', () => {
  it('follows the priority order and caps at the budget', () => {
    const paths = ['Dockerfile', 'src/main.go', 'go.mod', 'Makefile'];
    expect(selectKeyFiles(paths)).toEqual(['go.mod', 'Dockerfile', 'Makefile']);
  });

  it('never selects more than KEYFILE_BUDGET files', () => {
    const many = Array.from({ length: 30 }, (_, i) => `requirements-${String(i)}.txt`);
    expect(selectKeyFiles(many).length).toBeLessThanOrEqual(10);
  });
});

const REPO_JSON = JSON.stringify({
  full_name: 'octo/demo',
  default_branch: 'main',
  pushed_at: '2025-12-01T00:00:00Z',
  archived: false,
  stargazers_count: 120,
  open_issues_count: 4,
  license: { spdx_id: 'MIT' },
});

const TREE_JSON = JSON.stringify({
  sha: 'abc123',
  truncated: false,
  tree: [
    { path: 'go.mod', type: 'blob' },
    { path: 'cmd/app/main.go', type: 'blob' },
    { path: 'cmd', type: 'tree' },
  ],
});

describe('collectAnalysisInputs', () => {
  const routes = {
    '/git/trees/': respond(200, TREE_JSON),
    '/languages': respond(200, '{"Go":1000}'),
    '/releases/latest': respond(200, '{"published_at":"2025-11-01T00:00:00Z"}'),
    '/contributors': respond(200, '[{},{},{}]'),
    'raw.githubusercontent.com': respond(200, 'module example.com/demo\n\ngo 1.22\n'),
    '/repos/octo/demo': respond(200, REPO_JSON),
  };

  it('collects everything a full run needs and feeds a complete analysis', async () => {
    const calls: string[] = [];
    const { http } = mockHttp(routes, calls);
    const client = new GithubClient({ http, nowMs: NOW });

    const inputs = await collectAnalysisInputs(client, 'octo/demo', { nowMs: NOW });
    expect(inputs.headSha).toBe('abc123');
    expect(inputs.treePaths).toEqual(['go.mod', 'cmd/app/main.go']);
    expect(inputs.files.get('go.mod')).toContain('module example.com/demo');
    expect(inputs.health).toMatchObject({ stars: 120, contributorsCount: 3, licenseSpdxId: 'MIT' });
    // Only step J (LLM) is missing from a deterministic run.
    expect(inputs.skippedSteps).toEqual(['llm']);
    // Raw files are pinned to the resolved commit, never to a moving branch.
    expect(calls.some((url) => url.includes('/octo/demo/abc123/go.mod'))).toBe(true);

    const analysis = analyzeRepository(inputs);
    expect(analysis.completeness).toBe(0.9);
    expect(analysis.primaryLanguage).toBe('Go');
  });

  it('emits a partial analysis instead of failing when the budget runs out', async () => {
    const { http } = mockHttp(routes);
    // 2 requests: repo metadata plus the tree; everything after that is skipped.
    const client = new GithubClient({ http, nowMs: NOW, maxRequests: 2 });

    const inputs = await collectAnalysisInputs(client, 'octo/demo', { nowMs: NOW });
    expect(inputs.skippedSteps).toContain('classify');
    expect(inputs.skippedSteps).toContain('keyfiles');
    expect(inputs.files.size).toBe(0);
    expect(analyzeRepository(inputs).completeness).toBeLessThan(1);
  });

  it('propagates a real GitHub error rather than degrading silently', async () => {
    const { http } = mockHttp({
      '/git/trees/': respond(401, '{}'),
      '/repos/octo/demo': respond(200, REPO_JSON),
    });
    const client = new GithubClient({ http, nowMs: NOW });
    await expect(collectAnalysisInputs(client, 'octo/demo', { nowMs: NOW })).rejects.toMatchObject({
      code: 'GH_AUTH_REVOKED',
    });
  });
});
