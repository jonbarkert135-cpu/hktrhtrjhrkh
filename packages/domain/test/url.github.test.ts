/** GitHub URL detection and canonicalization (11_GITHUB.md §3): pure, synchronous, no network. */

import { describe, expect, it } from 'vitest';

import {
  MAX_BLOB_RANGE_LINES,
  canonicalGithubUrl,
  githubNodeKind,
  githubRefKey,
  parseGithubUrl,
  type GithubRef,
} from '../src/url/github.ts';

const parse = (input: string, enterpriseHost?: string): GithubRef | null =>
  parseGithubUrl(input, enterpriseHost === undefined ? {} : { enterpriseHost });

describe('recognised hosts (§3.2)', () => {
  it.each([
    'https://github.com/sherlock-project/sherlock',
    'https://www.github.com/sherlock-project/sherlock',
    'http://github.com/sherlock-project/sherlock',
    'github.com/sherlock-project/sherlock',
    '  https://github.com/sherlock-project/sherlock/  ',
  ])('accepts %s', (input) => {
    expect(parse(input)).toEqual({ kind: 'repo', owner: 'sherlock-project', repo: 'sherlock' });
  });

  it.each([
    'https://gitlab.com/owner/repo',
    'https://githubb.com/owner/repo',
    'https://objects.githubusercontent.com/some/asset',
    'ftp://github.com/owner/repo',
    'javascript:alert(1)//github.com/owner/repo',
    'not a url at all',
    '',
    '   ',
  ])('returns null for %s', (input) => {
    expect(parse(input)).toBeNull();
  });

  it('accepts the configured enterprise host only when configured', () => {
    const url = 'https://git.acme.example/acme/tool';
    expect(parse(url)).toBeNull();
    expect(parse(url, 'git.acme.example')).toEqual({ kind: 'repo', owner: 'acme', repo: 'tool' });
  });
});

describe('pattern table (§3.3)', () => {
  it.each<[string, GithubRef]>([
    ['https://github.com/owner/repo.git', { kind: 'repo', owner: 'owner', repo: 'repo' }],
    [
      'https://github.com/owner/repo?tab=readme-ov-file&utm_source=x',
      { kind: 'repo', owner: 'owner', repo: 'repo' },
    ],
    ['https://github.com/owner', { kind: 'owner', owner: 'owner', ownerType: 'unknown' }],
    ['https://github.com/orgs/acme', { kind: 'owner', owner: 'acme', ownerType: 'org' }],
    [
      'https://github.com/owner/repo/tree/v1.2.3',
      { kind: 'path', owner: 'owner', repo: 'repo', ref: 'v1.2.3', path: '', dir: true },
    ],
    [
      'https://github.com/owner/repo/tree/main/src/app',
      { kind: 'path', owner: 'owner', repo: 'repo', ref: 'main', path: 'src/app', dir: true },
    ],
    [
      'https://github.com/owner/repo/blob/main/src/index.ts',
      { kind: 'path', owner: 'owner', repo: 'repo', ref: 'main', path: 'src/index.ts', dir: false },
    ],
    [
      'https://github.com/owner/repo/blob/main/src/index.ts#L12',
      {
        kind: 'blobRange',
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        path: 'src/index.ts',
        startLine: 12,
        endLine: null,
      },
    ],
    [
      'https://github.com/owner/repo/blob/main/a.ts#L12-L48',
      {
        kind: 'blobRange',
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        path: 'a.ts',
        startLine: 12,
        endLine: 48,
      },
    ],
    [
      'https://github.com/owner/repo/issues/7',
      { kind: 'issue', owner: 'owner', repo: 'repo', number: 7 },
    ],
    [
      'https://github.com/owner/repo/pull/7',
      { kind: 'pull', owner: 'owner', repo: 'repo', number: 7 },
    ],
    [
      'https://github.com/owner/repo/pull/7/files',
      { kind: 'pull', owner: 'owner', repo: 'repo', number: 7 },
    ],
    [
      'https://github.com/owner/repo/discussions/3',
      { kind: 'discussion', owner: 'owner', repo: 'repo', number: 3 },
    ],
    [
      'https://github.com/owner/repo/releases/tag/v1.0.0',
      { kind: 'release', owner: 'owner', repo: 'repo', tag: 'v1.0.0' },
    ],
    [
      'https://github.com/owner/repo/releases/latest',
      { kind: 'release', owner: 'owner', repo: 'repo', tag: 'latest' },
    ],
    [
      'https://github.com/owner/repo/commit/0A1B2C3D4E5F60718293A4B5C6D7E8F901234567',
      {
        kind: 'commit',
        owner: 'owner',
        repo: 'repo',
        sha: '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567',
      },
    ],
    [
      'https://github.com/owner/repo/compare/v1...v2',
      { kind: 'compare', owner: 'owner', repo: 'repo', base: 'v1', head: 'v2' },
    ],
    ['https://gist.github.com/owner/abc123', { kind: 'gist', owner: 'owner', gistId: 'abc123' }],
    ['https://gist.github.com/abc123', { kind: 'gist', owner: null, gistId: 'abc123' }],
    [
      'https://raw.githubusercontent.com/owner/repo/main/src/a.ts',
      { kind: 'raw', owner: 'owner', repo: 'repo', ref: 'main', path: 'src/a.ts' },
    ],
  ])('parses %s', (input, expected) => {
    expect(parse(input)).toEqual(expected);
  });

  it('treats an unknown repo sub-route as the repository itself', () => {
    expect(parse('https://github.com/owner/repo/actions/runs/1')).toEqual({
      kind: 'repo',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it.each(['https://github.com/settings/profile', 'https://github.com/topics/osint'])(
    'does not read the site route %s as an owner',
    (input) => {
      expect(parse(input)).toBeNull();
    },
  );

  it.each([
    'https://github.com/owner/repo/issues/not-a-number',
    'https://github.com/owner/repo/commit/zzzz',
    'https://github.com/owner/repo/compare/v1',
    'https://github.com/owner/repo/releases',
    'https://raw.githubusercontent.com/owner/repo/main',
  ])('returns null for the malformed route %s', (input) => {
    expect(parse(input)).toBeNull();
  });
});

describe('canonicalization algorithm (§3.4)', () => {
  it('swaps a reversed line range and clamps the span', () => {
    expect(parse('https://github.com/o/r/blob/main/a.ts#L48-L12')).toMatchObject({
      startLine: 12,
      endLine: 48,
    });
    expect(parse('https://github.com/o/r/blob/main/a.ts#L1-L9999')).toMatchObject({
      startLine: 1,
      endLine: MAX_BLOB_RANGE_LINES,
    });
  });

  it('ignores a fragment that is not a line range', () => {
    expect(parse('https://github.com/o/r/blob/main/a.ts#readme')).toEqual({
      kind: 'path',
      owner: 'o',
      repo: 'r',
      ref: 'main',
      path: 'a.ts',
      dir: false,
    });
  });

  it('percent-decodes a segment once and rejects a hidden separator', () => {
    expect(parse('https://github.com/owner/re%20po')).toEqual({
      kind: 'repo',
      owner: 'owner',
      repo: 're po',
    });
    expect(parse('https://github.com/owner/re%2Fpo')).toBeNull();
    expect(parse('https://github.com/owner/%E0%A4%A')).toBeNull();
  });

  it('keeps the original case for display but folds it for the key (§3.4 step 7)', () => {
    const ref = parse('https://github.com/Sherlock-Project/Sherlock');
    expect(canonicalGithubUrl(ref!)).toBe('https://github.com/Sherlock-Project/Sherlock');
    expect(githubRefKey(ref!)).toBe('gh:repo:sherlock-project/sherlock');
  });
});

describe('canonicalGithubUrl', () => {
  it.each<[string, string]>([
    ['https://github.com/o/r/', 'https://github.com/o/r'],
    ['https://github.com/o/r/tree/v1', 'https://github.com/o/r/tree/v1'],
    ['https://github.com/o/r/tree/main/src', 'https://github.com/o/r/tree/main/src'],
    ['https://github.com/o/r/blob/main/a.ts', 'https://github.com/o/r/blob/main/a.ts'],
    ['https://github.com/o/r/blob/main/a.ts#L1-L4', 'https://github.com/o/r/blob/main/a.ts#L1-L4'],
    ['https://github.com/o/r/blob/main/a.ts#L1', 'https://github.com/o/r/blob/main/a.ts#L1'],
    ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/1'],
    ['https://github.com/o/r/pull/1/files', 'https://github.com/o/r/pull/1'],
    ['https://github.com/o/r/discussions/1', 'https://github.com/o/r/discussions/1'],
    ['https://github.com/o/r/releases/tag/v1', 'https://github.com/o/r/releases/tag/v1'],
    ['https://github.com/o/r/releases/latest', 'https://github.com/o/r/releases/latest'],
    ['https://github.com/o/r/commit/abc1234', 'https://github.com/o/r/commit/abc1234'],
    ['https://github.com/o/r/compare/a...b', 'https://github.com/o/r/compare/a...b'],
    ['https://github.com/o', 'https://github.com/o'],
    ['https://gist.github.com/o/abc', 'https://gist.github.com/o/abc'],
    ['https://gist.github.com/abc', 'https://gist.github.com/abc'],
    // §3.3: a raw URL canonicalizes to its blob URL.
    ['https://raw.githubusercontent.com/o/r/main/a.ts', 'https://github.com/o/r/blob/main/a.ts'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalGithubUrl(parse(input)!)).toBe(expected);
  });

  it('round-trips: the canonical URL parses to the same key', () => {
    for (const input of [
      'https://github.com/o/r',
      'https://github.com/o/r/blob/main/a.ts#L2-L5',
      'https://github.com/o/r/issues/9',
      'https://gist.github.com/o/abc',
    ]) {
      const ref = parse(input)!;
      expect(githubRefKey(parse(canonicalGithubUrl(ref))!)).toBe(githubRefKey(ref));
    }
  });
});

describe('githubRefKey (§3.4 examples, §7.2 identity)', () => {
  it.each<[string, string]>([
    ['https://github.com/sherlock-project/sherlock', 'gh:repo:sherlock-project/sherlock'],
    [
      'https://github.com/sherlock-project/sherlock/blob/v0.16.0/sherlock/sherlock.py#L1-L40',
      'gh:blob:sherlock-project/sherlock@v0.16.0:sherlock/sherlock.py#L1-L40',
    ],
    ['https://github.com/smicallef/spiderfoot/issues/1234', 'gh:issue:smicallef/spiderfoot#1234'],
    ['https://github.com/o/r/tree/main/src', 'gh:tree:o/r@main:src'],
    ['https://github.com/o/r/pull/3', 'gh:pull:o/r#3'],
    ['https://github.com/o/r/discussions/3', 'gh:discussion:o/r#3'],
    ['https://github.com/o/r/releases/tag/v1', 'gh:release:o/r@v1'],
    ['https://github.com/o/r/compare/a...b', 'gh:compare:o/r@a...b'],
    ['https://github.com/Acme', 'gh:owner:acme'],
    ['https://gist.github.com/o/AbC', 'gh:gist:abc'],
  ])('%s → %s', (input, key) => {
    expect(githubRefKey(parse(input)!)).toBe(key);
  });

  it('gives a raw URL and its blob URL the same identity', () => {
    expect(githubRefKey(parse('https://raw.githubusercontent.com/o/r/main/a.ts')!)).toBe(
      githubRefKey(parse('https://github.com/o/r/blob/main/a.ts')!),
    );
  });
});

describe('githubNodeKind (§3.3 node kinds)', () => {
  it.each<[string, string]>([
    ['https://github.com/o/r', 'repository'],
    ['https://github.com/o/r/tree/v1', 'repository'],
    ['https://github.com/o/r/tree/main/src', 'repo_path'],
    ['https://github.com/o/r/blob/main/a.ts', 'code_file'],
    ['https://github.com/o/r/blob/main/a.ts#L1', 'code_snippet'],
    ['https://raw.githubusercontent.com/o/r/main/a.ts', 'code_file'],
    ['https://github.com/o', 'person'],
    ['https://github.com/orgs/acme', 'organization'],
    ['https://github.com/o/r/issues/1', 'issue'],
    ['https://github.com/o/r/pull/1', 'pull_request'],
    ['https://github.com/o/r/discussions/1', 'discussion'],
    ['https://github.com/o/r/releases/latest', 'release'],
    ['https://github.com/o/r/commit/abc1234', 'commit'],
    ['https://github.com/o/r/compare/a...b', 'note'],
    ['https://gist.github.com/abc', 'gist'],
  ])('%s → %s', (input, kind) => {
    expect(githubNodeKind(parse(input)!)).toBe(kind);
  });
});

describe('performance budget (§3.5, ≤ 1 ms in the paste pipeline)', () => {
  it('parses a thousand URLs well inside the paste budget', () => {
    const started = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      parse(`https://github.com/owner/repo/blob/main/src/file${String(i)}.ts#L1-L20`);
    }
    expect((performance.now() - started) / 1000).toBeLessThan(1);
  });
});
