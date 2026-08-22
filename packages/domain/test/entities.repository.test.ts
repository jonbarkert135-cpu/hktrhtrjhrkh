/** RepositoryData schema (11_GITHUB.md §4.1): the node payload contract. */

import { describe, expect, it } from 'vitest';

import {
  README_MAX_BYTES,
  RepositoryDataSchema,
  RepositoryFetchSchema,
} from '../src/entities/repository.ts';

const minimal = {
  provider: 'github' as const,
  owner: 'sherlock-project',
  name: 'sherlock',
  fullName: 'sherlock-project/sherlock',
  key: 'gh:sherlock-project/sherlock',
  htmlUrl: 'https://github.com/sherlock-project/sherlock',
  apiUrl: 'https://api.github.com/repos/sherlock-project/sherlock',
  description: null,
  homepage: null,
  defaultBranch: 'master',
  pinnedRef: null,
  visibility: 'public' as const,
  isFork: false,
  parentFullName: null,
  isArchived: false,
  isTemplate: false,
  stars: 1,
  forks: 0,
  watchers: 0,
  openIssues: 3,
  openIssuesOnly: null,
  size: 42,
  license: null,
  languages: [],
  primaryLanguage: null,
  topics: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  pushedAt: '2026-01-01T00:00:00.000Z',
  latestRelease: null,
  readme: null,
  manifests: [],
  analysisId: null,
  fetch: {
    etag: null,
    lastFetchedAt: '2026-01-01T00:00:00.000Z',
    lastStatus: 'ok' as const,
    authMode: 'anonymous' as const,
    staleSince: null,
  },
};

describe('RepositoryDataSchema', () => {
  it('accepts a minimal anonymous-mode repository', () => {
    expect(RepositoryDataSchema.parse(minimal)).toEqual(minimal);
  });

  it('accepts the fully populated shape', () => {
    const full = {
      ...minimal,
      description: 'Hunt down social media accounts',
      homepage: 'https://sherlockproject.xyz',
      pinnedRef: 'v0.15.0',
      openIssuesOnly: 2,
      license: { spdxId: 'MIT', name: 'MIT License', url: 'https://api.github.com/licenses/mit' },
      languages: [{ name: 'Python', bytes: 100, pct: 100 }],
      primaryLanguage: 'Python',
      topics: ['osint'],
      latestRelease: {
        tag: 'v0.15.0',
        name: null,
        publishedAt: '2026-01-01T00:00:00.000Z',
        prerelease: false,
        url: 'https://github.com/sherlock-project/sherlock/releases/tag/v0.15.0',
      },
      readme: {
        path: 'README.md',
        sha: 'c'.repeat(40),
        markdown: '# Sherlock',
        renderedHtmlKey: null,
        truncated: false,
      },
      manifests: [{ ecosystem: 'pip' as const, path: 'pyproject.toml', sha: 'd'.repeat(40) }],
      analysisId: 'analysis-1',
    };
    expect(RepositoryDataSchema.parse(full)).toEqual(full);
  });

  it('rejects a non-github provider', () => {
    expect(RepositoryDataSchema.safeParse({ ...minimal, provider: 'gitlab' }).success).toBe(false);
  });

  it('rejects a non-url html url', () => {
    expect(RepositoryDataSchema.safeParse({ ...minimal, htmlUrl: 'not-a-url' }).success).toBe(
      false,
    );
  });

  it('rejects a missing fetch state', () => {
    const { fetch: _fetch, ...rest } = minimal;
    expect(RepositoryDataSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an unknown fetch status', () => {
    expect(
      RepositoryFetchSchema.safeParse({ ...minimal.fetch, lastStatus: 'teapot' }).success,
    ).toBe(false);
  });

  it('caps inline README size at 256 KiB', () => {
    expect(README_MAX_BYTES).toBe(262_144);
  });
});
