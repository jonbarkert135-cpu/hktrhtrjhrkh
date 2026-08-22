import { describe, expect, it } from 'vitest';

import { mapRepository, type RepoApi } from '../github/repository';

const api: RepoApi = {
  name: 'sherlock',
  full_name: 'sherlock-project/sherlock',
  html_url: 'https://github.com/sherlock-project/sherlock',
  url: 'https://api.github.com/repos/sherlock-project/sherlock',
  owner: { login: 'sherlock-project' },
  description: 'Hunt down social media accounts',
  homepage: '',
  default_branch: 'master',
  fork: false,
  archived: false,
  stargazers_count: 60_000,
  forks_count: 7_000,
  open_issues_count: 42,
  size: 900,
  license: { spdx_id: 'MIT', name: 'MIT License', url: null },
  topics: ['osint'],
  created_at: '2018-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  pushed_at: '2024-01-02T00:00:00Z',
};

const options = { key: 'gh:repo:sherlock-project/sherlock', fetchedAt: '2026-01-01T00:00:00.000Z' };

describe('mapRepository', () => {
  it('maps the API payload onto the §4.1 schema', () => {
    const data = mapRepository(api, { ...options, languages: { Python: 900, Shell: 100 } });
    expect(data).toMatchObject({
      provider: 'github',
      owner: 'sherlock-project',
      name: 'sherlock',
      fullName: 'sherlock-project/sherlock',
      key: options.key,
      defaultBranch: 'master',
      visibility: 'public',
      stars: 60_000,
      primaryLanguage: 'Python',
      license: { spdxId: 'MIT', name: 'MIT License', url: null },
    });
    expect(data.languages).toEqual([
      { name: 'Python', bytes: 900, pct: 90 },
      { name: 'Shell', bytes: 100, pct: 10 },
    ]);
    expect(data.fetch).toEqual({
      etag: null,
      lastFetchedAt: options.fetchedAt,
      lastStatus: 'ok',
      authMode: 'anonymous',
      staleSince: null,
    });
  });

  it('empty homepage becomes null rather than an invalid url', () => {
    expect(mapRepository(api, options).homepage).toBeNull();
  });

  it('survives a sparse payload by falling back to owner/name and the fetch time', () => {
    const data = mapRepository({ full_name: 'a/b' }, options);
    expect(data).toMatchObject({
      owner: 'a',
      name: 'b',
      htmlUrl: 'https://github.com/a/b',
      apiUrl: 'https://api.github.com/repos/a/b',
      defaultBranch: 'main',
      license: null,
      primaryLanguage: null,
      stars: 0,
      pushedAt: options.fetchedAt,
    });
  });

  it('private and internal repositories keep their visibility', () => {
    expect(mapRepository({ ...api, private: true }, options).visibility).toBe('private');
    expect(mapRepository({ ...api, visibility: 'internal' }, options).visibility).toBe('internal');
  });
});
