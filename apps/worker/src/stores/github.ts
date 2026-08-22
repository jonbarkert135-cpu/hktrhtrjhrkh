/**
 * Persistence for the GitHub handlers (11_GITHUB.md §4.3, §4.5, §5.10).
 *
 * Two backing stores, by design: node payloads (hydration + tab caches) are *document* state, so
 * they are written through `apps/sync`'s `/internal/nodes/patch` route — the worker never writes a
 * board itself (N4). Analyses and proposal drafts are plain rows in `github_analyses`.
 *
 * Reads use the projection (`nodes`), which is the queryable mirror of the doc. It can lag the doc
 * by one debounce cycle; that only ever costs a redundant fetch, never a lost write, because every
 * write is a merge performed inside the doc.
 */

import { prisma } from '@nexus/db';
import { parseGithubUrl, type RepositoryAnalysis, type RepositoryData } from '@nexus/domain';
import type {
  GithubHandlerStore,
  GithubTabName,
  RepositoryNodeRow,
} from '@nexus/integrations/github/handlers';
import type { IntegrationProposal } from '@nexus/integrations/github/proposal';

/** Merges `data` into a node's payload through the sync service. */
export type NodePatcher = (
  boardId: string,
  nodeId: string,
  data: Record<string, unknown>,
) => Promise<void>;

/** Tab caches live under one key in the node payload, so a patch touches nothing else. */
export const TABS_KEY = 'githubTabs';

interface TabCache {
  [tab: string]: { fetchedAt: string; payload: unknown } | undefined;
}

function tabsOf(data: Record<string, unknown>): TabCache {
  const tabs = data[TABS_KEY];
  return typeof tabs === 'object' && tabs !== null ? (tabs as TabCache) : {};
}

async function nodeRow(
  nodeId: string,
): Promise<{ boardId: string; data: Record<string, unknown> } | null> {
  const row = await prisma.boardProjectionNode.findUnique({
    where: { id: nodeId },
    select: { boardId: true, data: true },
  });
  if (row === null) return null;
  return { boardId: row.boardId, data: (row.data ?? {}) as Record<string, unknown> };
}

export function createGithubHandlerStore(patchNode: NodePatcher): GithubHandlerStore {
  return {
    async patchRepositoryNode(nodeId: string, data: RepositoryData) {
      const row = await nodeRow(nodeId);
      // The node was deleted while the job ran: dropping the fetch is correct, N8 only forbids
      // deleting cached data, not discarding a result nobody can see any more.
      if (row === null) return;
      await patchNode(row.boardId, nodeId, { ...data });
    },

    async readTab(nodeId: string, tab: GithubTabName) {
      const row = await nodeRow(nodeId);
      const entry = row === null ? undefined : tabsOf(row.data)[tab];
      return entry === undefined ? null : { fetchedAt: entry.fetchedAt };
    },

    async writeTab(nodeId: string, tab: GithubTabName, payload: unknown, fetchedAt: string) {
      const row = await nodeRow(nodeId);
      if (row === null) return;
      await patchNode(row.boardId, nodeId, {
        [TABS_KEY]: { ...tabsOf(row.data), [tab]: { fetchedAt, payload } },
      });
    },

    async saveAnalysis(analysis: RepositoryAnalysis) {
      // §5.10: (repo, head, analyzer version) is the cache key, so a re-analysis overwrites in place.
      const row = await prisma.githubAnalysis.upsert({
        where: {
          repoKey_headSha_analyzerVersion: {
            repoKey: analysis.repoKey,
            headSha: analysis.headSha,
            analyzerVersion: analysis.analyzerVersion,
          },
        },
        create: {
          id: crypto.randomUUID(),
          repoKey: analysis.repoKey,
          headSha: analysis.headSha,
          analyzerVersion: analysis.analyzerVersion,
          payload: analysis as unknown as Record<string, never>,
        },
        update: { payload: analysis as unknown as Record<string, never> },
        select: { id: true },
      });
      return row.id;
    },

    async loadAnalysis(analysisId: string) {
      const row = await prisma.githubAnalysis.findUnique({
        where: { id: analysisId },
        select: { payload: true },
      });
      return row === null ? null : (row.payload as unknown as RepositoryAnalysis);
    },

    async saveProposal(proposal: IntegrationProposal) {
      await prisma.githubAnalysis.update({
        where: { id: proposal.analysisId },
        data: { proposal: proposal as unknown as Record<string, never> },
      });
    },

    async listRepositoryNodes(boardId: string) {
      const rows = await prisma.boardProjectionNode.findMany({
        where: { boardId, type: 'repository', deletedAt: null },
        select: { id: true, data: true },
        take: 5000,
      });
      const nodes: RepositoryNodeRow[] = [];
      for (const row of rows) {
        const data = (row.data ?? {}) as Record<string, unknown>;
        const htmlUrl = data['htmlUrl'];
        if (typeof htmlUrl !== 'string') continue;
        const ref = parseGithubUrl(htmlUrl);
        if (ref === null) continue;
        const fetchState = data['fetch'];
        const lastFetchedAt =
          typeof fetchState === 'object' && fetchState !== null
            ? ((fetchState as { lastFetchedAt?: unknown }).lastFetchedAt ?? null)
            : null;
        nodes.push({
          nodeId: row.id,
          repoKey: typeof data['fullName'] === 'string' ? data['fullName'] : '',
          lastFetchedAt: typeof lastFetchedAt === 'string' ? lastFetchedAt : null,
          ref,
        });
      }
      return nodes;
    },

    async repoKeyOfNode(nodeId: string) {
      const row = await nodeRow(nodeId);
      const fullName = row?.data['fullName'];
      return typeof fullName === 'string' ? fullName : null;
    },
  };
}

/** Production patcher: the sync service's `/internal/nodes/patch` route, same secret as apply. */
export function syncNodePatcher(
  env: { SYNC_URL: string; SYNC_SHARED_SECRET: string },
  fetchImpl: typeof fetch = fetch,
): NodePatcher {
  return async (boardId, nodeId, data) => {
    const response = await fetchImpl(`${env.SYNC_URL.replace(/\/$/, '')}/internal/nodes/patch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.SYNC_SHARED_SECRET}`,
      },
      body: JSON.stringify({ boardId, nodeId, data, now: new Date().toISOString() }),
    });
    if (!response.ok) {
      throw new Error(`sync refused the node patch (${String(response.status)})`);
    }
  };
}
