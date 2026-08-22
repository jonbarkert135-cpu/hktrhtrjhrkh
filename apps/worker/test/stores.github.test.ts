/**
 * The GitHub handler store: node payload reads/writes through the sync patch route, and the
 * `github_analyses` rows behind analysis/proposal caching (11_GITHUB.md §4.3, §4.5, §5.10).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryAnalysis, RepositoryData } from '@nexus/domain';
import type { IntegrationProposal } from '@nexus/integrations/github/proposal';

const prismaMock = {
  boardProjectionNode: { findUnique: vi.fn(), findMany: vi.fn() },
  githubAnalysis: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
};

vi.mock('@nexus/db', () => ({ prisma: prismaMock }));

const { createGithubHandlerStore, syncNodePatcher, TABS_KEY } = await import(
  '../src/stores/github.ts'
);

const patch = vi.fn(() => Promise.resolve());
const store = createGithubHandlerStore(patch);

const repoData = { fullName: 'a/b', key: 'gh:repo:a/b' } as unknown as RepositoryData;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('node payload', () => {
  it('patches the repository node through the sync route', async () => {
    prismaMock.boardProjectionNode.findUnique.mockResolvedValueOnce({
      boardId: 'board-1',
      data: {},
    });
    await store.patchRepositoryNode('n1', repoData);
    expect(patch).toHaveBeenCalledWith('board-1', 'n1', { fullName: 'a/b', key: 'gh:repo:a/b' });
  });

  it.each([
    ['patchRepositoryNode', () => store.patchRepositoryNode('gone', repoData)],
    ['writeTab', () => store.writeTab('gone', 'readme', {}, 'now')],
  ])('%s is a no-op for a node that no longer exists', async (_label, call) => {
    prismaMock.boardProjectionNode.findUnique.mockResolvedValueOnce(null);
    await call();
    expect(patch).not.toHaveBeenCalled();
  });

  it('reads a cached tab timestamp and returns null when there is none', async () => {
    prismaMock.boardProjectionNode.findUnique
      .mockResolvedValueOnce({
        boardId: 'b',
        data: { [TABS_KEY]: { readme: { fetchedAt: 't0', payload: 1 } } },
      })
      .mockResolvedValueOnce({ boardId: 'b', data: {} })
      .mockResolvedValueOnce(null);

    expect(await store.readTab('n1', 'readme')).toEqual({ fetchedAt: 't0' });
    expect(await store.readTab('n1', 'readme')).toBeNull();
    expect(await store.readTab('n1', 'readme')).toBeNull();
  });

  it('keeps the other cached tabs when writing one', async () => {
    prismaMock.boardProjectionNode.findUnique.mockResolvedValueOnce({
      boardId: 'b',
      data: { [TABS_KEY]: { readme: { fetchedAt: 't0', payload: 'old' } } },
    });
    await store.writeTab('n1', 'issues', ['i'], 't1');
    expect(patch.mock.lastCall).toEqual([
      'b',
      'n1',
      {
        [TABS_KEY]: {
          readme: { fetchedAt: 't0', payload: 'old' },
          issues: { fetchedAt: 't1', payload: ['i'] },
        },
      },
    ]);
  });

  it('resolves the repo key of a node, or null when it is not hydrated', async () => {
    prismaMock.boardProjectionNode.findUnique
      .mockResolvedValueOnce({ boardId: 'b', data: { fullName: 'a/b' } })
      .mockResolvedValueOnce({ boardId: 'b', data: {} });
    expect(await store.repoKeyOfNode('n1')).toBe('a/b');
    expect(await store.repoKeyOfNode('n1')).toBeNull();
  });
});

describe('listRepositoryNodes', () => {
  it('maps hydrated rows and skips the ones without a usable GitHub url', async () => {
    prismaMock.boardProjectionNode.findMany.mockResolvedValueOnce([
      {
        id: 'n1',
        data: {
          htmlUrl: 'https://github.com/a/b',
          fullName: 'a/b',
          fetch: { lastFetchedAt: 't0' },
        },
      },
      { id: 'n2', data: { htmlUrl: 'https://example.com/a/b' } },
      { id: 'n3', data: {} },
      { id: 'n4', data: { htmlUrl: 'https://github.com/c/d' } },
    ]);

    const rows = await store.listRepositoryNodes('board-1');
    expect(rows).toEqual([
      {
        nodeId: 'n1',
        repoKey: 'a/b',
        lastFetchedAt: 't0',
        ref: expect.objectContaining({ owner: 'a', repo: 'b' }) as unknown,
      },
      {
        nodeId: 'n4',
        repoKey: '',
        lastFetchedAt: null,
        ref: expect.objectContaining({ owner: 'c', repo: 'd' }) as unknown,
      },
    ]);
  });

  it('defaults a missing `data` column to an empty payload', async () => {
    prismaMock.boardProjectionNode.findMany.mockResolvedValueOnce([{ id: 'n1', data: null }]);
    expect(await store.listRepositoryNodes('board-1')).toEqual([]);
  });
});

describe('analyses', () => {
  const analysis = {
    repoKey: 'a/b',
    headSha: 'sha',
    analyzerVersion: '1.0.0',
  } as unknown as RepositoryAnalysis;

  it('upserts on the (repo, head, analyzer) cache key and returns the row id', async () => {
    prismaMock.githubAnalysis.upsert.mockResolvedValueOnce({ id: 'an-1' });
    expect(await store.saveAnalysis(analysis)).toBe('an-1');
    expect(prismaMock.githubAnalysis.upsert.mock.lastCall?.[0]).toMatchObject({
      where: {
        repoKey_headSha_analyzerVersion: {
          repoKey: 'a/b',
          headSha: 'sha',
          analyzerVersion: '1.0.0',
        },
      },
    });
  });

  it('loads an analysis payload, and null when the row is gone', async () => {
    prismaMock.githubAnalysis.findUnique
      .mockResolvedValueOnce({ payload: analysis })
      .mockResolvedValueOnce(null);
    expect(await store.loadAnalysis('an-1')).toEqual(analysis);
    expect(await store.loadAnalysis('an-1')).toBeNull();
  });

  it('stores a proposal draft on its analysis row', async () => {
    const proposal = { analysisId: 'an-1', id: 'p-1' } as unknown as IntegrationProposal;
    await store.saveProposal(proposal);
    expect(prismaMock.githubAnalysis.update.mock.lastCall?.[0]).toMatchObject({
      where: { id: 'an-1' },
      data: { proposal },
    });
  });
});

describe('syncNodePatcher', () => {
  const env = { SYNC_URL: 'http://sync:3002/', SYNC_SHARED_SECRET: 'secret' };

  it('posts the patch to the internal route with the shared secret', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: true } as Response));
    await syncNodePatcher(env, fetchImpl)('b1', 'n1', { stars: 3 });

    const [url, init] = fetchImpl.mock.lastCall as unknown as [string, RequestInit];
    expect(url).toBe('http://sync:3002/internal/nodes/patch');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)).toMatchObject({
      boardId: 'b1',
      nodeId: 'n1',
      data: { stars: 3 },
    });
  });

  it('throws when sync refuses the patch', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: false, status: 422 } as Response));
    await expect(syncNodePatcher(env, fetchImpl)('b1', 'n1', {})).rejects.toThrow(/422/);
  });
});
