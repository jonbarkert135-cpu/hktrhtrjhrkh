import { describe, expect, it } from 'vitest';

import {
  MAX_PACKAGE_NODES,
  mapRepositoryImport,
  packageKey,
  resolveNode,
  type BoardNode,
  type MapInput,
} from '../github/mapper';

const base: MapInput = {
  repo: {
    key: 'gh:repo:sherlock-project/sherlock',
    fullName: 'sherlock-project/sherlock',
    topics: ['osint', 'python'],
    owner: {
      key: 'github:1234',
      kind: 'organization',
      login: 'sherlock-project',
    },
  },
};

describe('resolveNode', () => {
  it('merges on the exact external key, case-insensitively', () => {
    const board: BoardNode[] = [{ id: 'n1', kind: 'repository', key: 'gh:repo:a/b' }];
    expect(resolveNode({ key: 'GH:REPO:A/B', kind: 'repository', data: {} }, board)).toMatchObject({
      action: 'merge',
      existingId: 'n1',
    });
  });

  it('merges on an alias key and records renamedFrom', () => {
    const board: BoardNode[] = [
      { id: 'n1', kind: 'repository', key: 'gh:repo:a/new', aliasKeys: ['gh:repo:a/old'] },
    ];
    expect(
      resolveNode({ key: 'gh:repo:a/old', kind: 'repository', data: {} }, board),
    ).toMatchObject({ action: 'merge', existingId: 'n1', renamedFrom: 'gh:repo:a/old' });
  });

  it('prefers the numeric github id over the login', () => {
    const board: BoardNode[] = [
      { id: 'p1', kind: 'person', key: 'github:9', githubUserId: '9', login: 'renamed' },
    ];
    const got = resolveNode(
      { key: 'github:9', kind: 'person', data: {}, githubUserId: '9', login: 'newname' },
      board,
    );
    expect(got).toMatchObject({ action: 'merge', existingId: 'p1' });
  });

  it('creates a separate flagged node when a login collides with a different id', () => {
    const board: BoardNode[] = [
      { id: 'p1', kind: 'person', key: 'github:9', githubUserId: '9', login: 'octocat' },
    ];
    const got = resolveNode(
      { key: 'github:10', kind: 'person', data: {}, githubUserId: '10', login: 'octocat' },
      board,
    );
    expect(got.action).toBe('create');
    expect(got.reviewChip).toContain('impersonation');
  });

  it('never dedupes repositories by name similarity', () => {
    const board: BoardNode[] = [{ id: 'n1', kind: 'repository', key: 'gh:repo:a/sherlock' }];
    expect(
      resolveNode({ key: 'gh:repo:b/sherlock', kind: 'repository', data: {} }, board),
    ).toMatchObject({ action: 'create' });
  });
});

describe('mapRepositoryImport', () => {
  it('always emits the repository, its owner and an owned_by edge', () => {
    const { nodes, edges } = mapRepositoryImport(base);
    expect(nodes.map((n) => n.kind)).toEqual(['repository', 'organization']);
    expect(edges).toEqual([{ kind: 'owned_by', fromKey: base.repo.key, toKey: 'github:1234' }]);
  });

  it('emits forked_from only when the parent is known', () => {
    const withFork = mapRepositoryImport({
      ...base,
      repo: { ...base.repo, isFork: true, parentKey: 'gh:repo:up/stream' },
    });
    expect(withFork.edges).toContainEqual({
      kind: 'forked_from',
      fromKey: base.repo.key,
      toKey: 'gh:repo:up/stream',
    });
    const orphan = mapRepositoryImport({
      ...base,
      repo: { ...base.repo, isFork: true, parentKey: null },
    });
    expect(orphan.edges.some((e) => e.kind === 'forked_from')).toBe(false);
  });

  it('creates one package node per direct dependency', () => {
    const { nodes, edges } = mapRepositoryImport({
      ...base,
      dependencies: [
        { ecosystem: 'PyPI', name: 'Requests' },
        { ecosystem: 'pypi', name: 'rich' },
      ],
    });
    expect(nodes.filter((n) => n.kind === 'package').map((n) => n.key)).toEqual([
      packageKey('pypi', 'requests'),
      packageKey('pypi', 'rich'),
    ]);
    expect(edges.filter((e) => e.kind === 'depends_on')).toHaveLength(2);
  });

  it('collapses oversized dependency imports into one group node per ecosystem', () => {
    const dependencies = [
      ...Array.from({ length: MAX_PACKAGE_NODES }, (_, i) => ({ ecosystem: 'npm', name: `n${i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ ecosystem: 'pypi', name: `p${i}` })),
    ];
    const { nodes } = mapRepositoryImport({ ...base, dependencies });
    const groups = nodes.filter((n) => n.kind === 'dependency_group');
    expect(nodes.some((n) => n.kind === 'package')).toBe(false);
    expect(groups.map((n) => n.data)).toEqual([
      { ecosystem: 'npm', count: MAX_PACKAGE_NODES },
      { ecosystem: 'pypi', count: 5 },
    ]);
  });

  it('adds low-confidence mentioned_in edges for README links, skipping self-links', () => {
    const { edges } = mapRepositoryImport({
      ...base,
      readmeRepoKeys: ['gh:repo:other/thing', base.repo.key],
    });
    expect(edges.filter((e) => e.kind === 'mentioned_in')).toEqual([
      {
        kind: 'mentioned_in',
        fromKey: base.repo.key,
        toKey: 'gh:repo:other/thing',
        confidence: 0.5,
      },
    ]);
  });

  it('relates repos sharing at least two topics with the board', () => {
    const board: BoardNode[] = [
      { id: 'r1', kind: 'repository', key: 'gh:repo:x/y', topics: ['OSINT', 'python', 'cli'] },
      { id: 'r2', kind: 'repository', key: 'gh:repo:x/z', topics: ['python'] },
    ];
    const { edges } = mapRepositoryImport({ ...base, board });
    expect(edges.filter((e) => e.kind === 'related_to')).toEqual([
      { kind: 'related_to', fromKey: base.repo.key, toKey: 'gh:repo:x/y', confidence: 0.4 },
    ]);
  });

  it('does not emit the same node twice', () => {
    const { nodes } = mapRepositoryImport({
      ...base,
      contributors: [
        { key: 'github:7', kind: 'person', data: {}, login: 'a', githubUserId: '7' },
        { key: 'github:7', kind: 'person', data: {}, login: 'a', githubUserId: '7' },
      ],
    });
    expect(nodes.filter((n) => n.key === 'github:7')).toHaveLength(1);
  });
});
