/**
 * The GitHub manifest, its error copy and its credential selection — the three pure pieces the
 * adapter is built on (11_GITHUB.md §2, §9; 10_INTEGRATIONS.md §4).
 */

import { describe, expect, it } from 'vitest';
import { builtinEdgeTypes, builtinNodeTypes } from '@nexus/domain';

import { GITHUB_API_HOST, GITHUB_ID, GITHUB_RAW_HOST, manifest } from '../github/manifest.ts';
import {
  GithubError,
  classifyResponse,
  githubErrorCopy,
  type GithubErrorCode,
} from '../github/errors.ts';
import { credentialId, isAuthenticated, selectCredential } from '../github/auth/select.ts';
import { checkManifestConformance } from '../src/testkit/index.ts';

const headers = (values: Record<string, string>) => (name: string) => values[name] ?? null;

describe('manifest (§1, §2, 10_INTEGRATIONS.md §4)', () => {
  it('conforms to the framework schema and this build’s node and edge registries', () => {
    expect(
      checkManifestConformance(manifest, {
        knownNodeTypes: new Set(
          builtinNodeTypes()
            .list()
            .map((definition) => definition.type),
        ),
        knownEdgeTypes: new Set(
          builtinEdgeTypes()
            .list()
            .map((definition) => definition.type),
        ),
      }),
    ).toEqual([]);
  });

  it('is HTTP-only: no container image and no sandbox execution (§1 table)', () => {
    expect(manifest.id).toBe(GITHUB_ID);
    expect(manifest.execution.kind).toBe('http');
  });

  it('reaches exactly the two documented hosts, with private ranges denied (§9, N7)', () => {
    if (manifest.execution.kind !== 'http') throw new Error('expected an http manifest');
    expect(manifest.execution.network.allow).toEqual([GITHUB_API_HOST, GITHUB_RAW_HOST]);
    expect(manifest.execution.network.mode).toBe('allowlist');
    expect(manifest.execution.network.denyPrivateRanges).toBe(true);
    expect(manifest.execution.baseUrl).toBe(`https://${GITHUB_API_HOST}`);
  });

  it('asks for no write permission anywhere (§2.2)', () => {
    expect(manifest.permissions).toEqual(['net:allowlist', 'graph:read', 'graph:propose']);
    expect(manifest.permissions).not.toContain('net:broad');
    expect(manifest.permissions.some((permission) => permission.endsWith(':write'))).toBe(false);
  });

  it('declares the analysis fetch set the agent needs', () => {
    if (manifest.execution.kind !== 'http') throw new Error('expected an http manifest');
    expect(manifest.execution.requests.map((request) => request.name)).toEqual([
      'repo',
      'readme',
      'languages',
      'license',
      'releases',
      'contributors',
      'issues',
    ]);
    for (const request of manifest.execution.requests) {
      expect(request.method).toBe('GET');
      expect(request.headers.accept).toBe('application/vnd.github+json');
      expect(request.secretHeaders).toEqual({});
    }
  });

  it('requires consent naming both hosts and the read-only nature of the run (§12 of P9)', () => {
    expect(manifest.consent.required).toBe(true);
    expect(manifest.consent.scopeText).toContain(GITHUB_API_HOST);
    expect(manifest.consent.scopeText).toContain(GITHUB_RAW_HOST);
    expect(manifest.consent.allowedTargetScopes).toEqual(['public-index']);
  });

  it('maps the repository, its owner, contributors and homepage', () => {
    expect(manifest.entityMappings.map((mapping) => mapping.id)).toEqual([
      'repository',
      'owner',
      'contributor',
      'homepage',
    ]);
  });
});

describe('classifyResponse (§9)', () => {
  it('returns null for a successful response', () => {
    expect(classifyResponse({ status: 200, headers: headers({}) })).toBeNull();
    expect(classifyResponse({ status: 304, headers: headers({}) })).toBeNull();
  });

  it.each<[number, Record<string, string>, string, GithubErrorCode]>([
    [403, { 'x-ratelimit-remaining': '0' }, '', 'GH_RATE_PRIMARY'],
    [429, {}, '', 'GH_RATE_SECONDARY'],
    [403, {}, 'secondary rate limit', 'GH_RATE_SECONDARY'],
    [401, {}, '', 'GH_AUTH_REVOKED'],
    [403, {}, 'Forbidden', 'GH_FORBIDDEN'],
    [404, {}, '', 'GH_NOT_FOUND'],
    [413, {}, '', 'GH_TOO_LARGE'],
    [502, {}, '', 'GH_NETWORK'],
    [422, {}, '', 'GH_PARSE'],
  ])('maps %i to %s', (status, values, body, code) => {
    expect(classifyResponse({ status, headers: headers(values), body })?.code).toBe(code);
  });

  it('attaches the reset time to a primary rate limit so the UI can name it', () => {
    const error = classifyResponse({
      status: 403,
      headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }),
    });
    expect(error?.retryAt).toBe(1_800_000_000_000);
  });
});

describe('githubErrorCopy (§9 table)', () => {
  const NOW = Date.parse('2026-02-01T14:10:00.000Z');

  it('names the reset time and offers connecting an account when anonymous', () => {
    const copy = githubErrorCopy(
      new GithubError('GH_RATE_PRIMARY', { retryAt: Date.parse('2026-02-01T14:32:00.000Z') }),
      { nowMs: NOW },
    );
    expect(copy.title).toBe('GitHub rate limit reached');
    expect(copy.body).toContain('in 22 min');
    expect(copy.action).toBe('Connect an account');
  });

  it('offers a reset notification instead once a connection exists', () => {
    expect(
      githubErrorCopy(new GithubError('GH_RATE_PRIMARY'), { nowMs: NOW, authenticated: true })
        .action,
    ).toBe('Notify me when it resets');
  });

  it('names the repository and the cached data in the 404 copy', () => {
    const copy = githubErrorCopy(new GithubError('GH_NOT_FOUND'), {
      owner: 'smicallef',
      repo: 'spiderfoot',
      cachedAt: '12 Jan 2026',
    });
    expect(copy.body).toContain('github.com/smicallef/spiderfoot');
    expect(copy.body).toContain('12 Jan 2026');
  });

  it('states sizes in the too-large copy and counts in the partial copy', () => {
    expect(
      githubErrorCopy(new GithubError('GH_TOO_LARGE'), {
        fileBytes: 13_002_342,
        previewCapBytes: 262_144,
      }).body,
    ).toBe('This file is 12.4 MB; Raven previews up to 256 KB.');
    expect(
      githubErrorCopy(new GithubError('GH_ANALYSIS_PARTIAL'), { skipped: 4, total: 10 }).body,
    ).toBe('4 of 10 steps were skipped because of the anonymous request budget.');
  });

  it('produces copy with a title, a reason and an action for every code', () => {
    for (const code of [
      'GH_RATE_SECONDARY',
      'GH_FORBIDDEN',
      'GH_AUTH_REVOKED',
      'GH_NETWORK',
      'GH_PARSE',
      'GH_TRUNCATED_TREE',
    ] satisfies GithubErrorCode[]) {
      const copy = githubErrorCopy(new GithubError(code), { analyzedDirectories: 12 });
      expect(copy.title.length).toBeGreaterThan(5);
      expect(copy.body.length).toBeGreaterThan(20);
      expect(copy.action.length).toBeGreaterThan(3);
    }
  });
});

describe('selectCredential (§2.3)', () => {
  const base = { owner: 'Acme', userId: 'u1' };

  it('prefers an App installation covering the owner, case-insensitively', () => {
    expect(
      selectCredential({
        ...base,
        appInstallations: [{ id: '42', owners: ['acme'] }],
        userToken: { status: 'active' },
        serviceToken: true,
      }),
    ).toEqual({ kind: 'app', installationId: '42' });
  });

  it('falls back to the user token, then the service token, then anonymous', () => {
    expect(
      selectCredential({ ...base, userToken: { status: 'active' }, serviceToken: true }),
    ).toEqual({ kind: 'user', userId: 'u1' });
    expect(
      selectCredential({ ...base, userToken: { status: 'revoked' }, serviceToken: true }),
    ).toEqual({ kind: 'service' });
    expect(selectCredential(base)).toEqual({ kind: 'anonymous' });
    expect(
      selectCredential({ ...base, appInstallations: [{ id: '42', owners: ['other'] }] }),
    ).toEqual({ kind: 'anonymous' });
  });

  it('names one budget bucket per credential (§8.1)', () => {
    expect(credentialId({ kind: 'app', installationId: '42' })).toBe('app:42');
    expect(credentialId({ kind: 'user', userId: 'u1' })).toBe('user:u1');
    expect(credentialId({ kind: 'service' })).toBe('service');
    expect(credentialId({ kind: 'anonymous' })).toBe('anonymous');
    expect(isAuthenticated({ kind: 'anonymous' })).toBe(false);
    expect(isAuthenticated({ kind: 'service' })).toBe(true);
  });
});
