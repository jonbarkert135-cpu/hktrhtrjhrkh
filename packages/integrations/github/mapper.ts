/**
 * Graph mapping for the GitHub integration (11_GITHUB.md §7).
 *
 * Pure and deterministic: given what hydration found plus what is already on the board, it
 * returns the nodes and edges an Import Proposal should contain. Nothing here writes anything
 * (N4) and nothing here fetches anything (N5) — the caller applies the result through the
 * proposal review UI.
 */

export type GithubEdgeKind =
  | 'owned_by'
  | 'contributed_to'
  | 'forked_from'
  | 'depends_on'
  | 'released'
  | 'references'
  | 'authored'
  | 'mentioned_in'
  | 'related_to'
  | 'has_file';

/** A node already present on the board, as far as dedupe cares. */
export interface BoardNode {
  id: string;
  kind: string;
  /** `nodes.external_key` — `gh:…`, `github:{id}` or `pkg:{eco}:{name}`. */
  key: string;
  aliasKeys?: string[];
  /** Numeric GitHub user id, for `person` nodes. */
  githubUserId?: string;
  login?: string;
  topics?: string[];
}

export interface CandidateNode {
  key: string;
  kind: string;
  data: Record<string, unknown>;
  /** Numeric GitHub user id, when the candidate is a person. */
  githubUserId?: string;
  login?: string;
}

export interface MappedNode extends CandidateNode {
  action: 'create' | 'merge';
  existingId?: string;
  renamedFrom?: string;
  reviewChip?: string;
}

export interface MappedEdge {
  kind: GithubEdgeKind;
  fromKey: string;
  toKey: string;
  /** Only set for the heuristic edges; the rest are structural facts. */
  confidence?: number;
}

export interface MapInput {
  repo: {
    key: string;
    fullName: string;
    topics?: string[];
    isFork?: boolean;
    parentKey?: string | null;
    owner: { key: string; kind: 'person' | 'organization'; login: string; userId?: string };
  };
  /** Opt-in imports, already filtered to the user's selection. */
  contributors?: CandidateNode[];
  dependencies?: { ecosystem: string; name: string }[];
  releases?: CandidateNode[];
  files?: CandidateNode[];
  /** Repo keys linked from the README (§7.1, confidence 0.5). */
  readmeRepoKeys?: string[];
  board?: BoardNode[];
}

export interface MapResult {
  nodes: MappedNode[];
  edges: MappedEdge[];
}

/** §7.1 — beyond this many package nodes, propose one summary node per ecosystem instead. */
export const MAX_PACKAGE_NODES = 40;
const MENTIONED_IN_CONFIDENCE = 0.5;
const RELATED_TO_CONFIDENCE = 0.4;
const RELATED_TO_MIN_SHARED_TOPICS = 2;

const lower = (s: string): string => s.toLowerCase();

export function packageKey(ecosystem: string, name: string): string {
  return `pkg:${lower(ecosystem)}:${lower(name)}`;
}

/**
 * §7.2 resolution order: exact key → alias key → person identity → package identity.
 * There is deliberately no fuzzy step.
 */
export function resolveNode(candidate: CandidateNode, board: BoardNode[] = []): MappedNode {
  const key = lower(candidate.key);
  const exact = board.find((n) => lower(n.key) === key);
  if (exact) return { ...candidate, action: 'merge', existingId: exact.id };

  const alias = board.find((n) => (n.aliasKeys ?? []).some((a) => lower(a) === key));
  if (alias) {
    return { ...candidate, action: 'merge', existingId: alias.id, renamedFrom: candidate.key };
  }

  if (candidate.kind === 'person') {
    if (candidate.githubUserId !== undefined) {
      const byId = board.find(
        (n) => n.kind === 'person' && n.githubUserId === candidate.githubUserId,
      );
      if (byId) return { ...candidate, action: 'merge', existingId: byId.id };
    }
    if (candidate.login !== undefined) {
      const byLogin = board.find(
        (n) =>
          n.kind === 'person' &&
          n.login !== undefined &&
          lower(n.login) === lower(candidate.login as string),
      );
      if (byLogin) {
        // Same login, different numeric id → separate node, both flagged (§7.2 rule 3).
        if (
          byLogin.githubUserId !== undefined &&
          candidate.githubUserId !== undefined &&
          byLogin.githubUserId !== candidate.githubUserId
        ) {
          return { ...candidate, action: 'create', reviewChip: 'possible rename/impersonation' };
        }
        return { ...candidate, action: 'merge', existingId: byLogin.id };
      }
    }
  }

  return { ...candidate, action: 'create' };
}

function sharedTopicCount(a: string[] = [], b: string[] = []): number {
  const set = new Set(a.map(lower));
  return b.filter((t) => set.has(lower(t))).length;
}

/** Build the node/edge set for one repository import (§7.1). */
export function mapRepositoryImport(input: MapInput): MapResult {
  const board = input.board ?? [];
  const candidates: CandidateNode[] = [
    {
      key: input.repo.key,
      kind: 'repository',
      data: { fullName: input.repo.fullName, topics: input.repo.topics ?? [] },
    },
    {
      key: input.repo.owner.key,
      kind: input.repo.owner.kind,
      data: { login: input.repo.owner.login },
      login: input.repo.owner.login,
      ...(input.repo.owner.userId === undefined ? {} : { githubUserId: input.repo.owner.userId }),
    },
    ...(input.contributors ?? []),
    ...(input.releases ?? []),
    ...(input.files ?? []),
  ];

  const edges: MappedEdge[] = [
    { kind: 'owned_by', fromKey: input.repo.key, toKey: input.repo.owner.key },
  ];

  for (const c of input.contributors ?? []) {
    edges.push({ kind: 'contributed_to', fromKey: c.key, toKey: input.repo.key });
  }
  for (const r of input.releases ?? []) {
    edges.push({ kind: 'released', fromKey: input.repo.key, toKey: r.key });
  }
  for (const f of input.files ?? []) {
    edges.push({ kind: 'has_file', fromKey: input.repo.key, toKey: f.key });
  }
  if (
    input.repo.isFork === true &&
    input.repo.parentKey !== null &&
    input.repo.parentKey !== undefined &&
    input.repo.parentKey !== ''
  ) {
    edges.push({ kind: 'forked_from', fromKey: input.repo.key, toKey: input.repo.parentKey });
  }

  const deps = input.dependencies ?? [];
  if (deps.length > MAX_PACKAGE_NODES) {
    const byEco = new Map<string, number>();
    for (const d of deps) byEco.set(lower(d.ecosystem), (byEco.get(lower(d.ecosystem)) ?? 0) + 1);
    for (const [ecosystem, count] of [...byEco].sort(([a], [b]) => a.localeCompare(b))) {
      const key = `pkg-group:${ecosystem}:${input.repo.key}`;
      candidates.push({ key, kind: 'dependency_group', data: { ecosystem, count } });
      edges.push({ kind: 'depends_on', fromKey: input.repo.key, toKey: key });
    }
  } else {
    for (const d of deps) {
      const key = packageKey(d.ecosystem, d.name);
      candidates.push({
        key,
        kind: 'package',
        data: { ecosystem: lower(d.ecosystem), name: d.name },
      });
      edges.push({ kind: 'depends_on', fromKey: input.repo.key, toKey: key });
    }
  }

  for (const key of input.readmeRepoKeys ?? []) {
    if (lower(key) === lower(input.repo.key)) continue;
    edges.push({
      kind: 'mentioned_in',
      fromKey: input.repo.key,
      toKey: key,
      confidence: MENTIONED_IN_CONFIDENCE,
    });
  }

  for (const n of board) {
    if (n.kind !== 'repository' || lower(n.key) === lower(input.repo.key)) continue;
    if (sharedTopicCount(input.repo.topics, n.topics) >= RELATED_TO_MIN_SHARED_TOPICS) {
      edges.push({
        kind: 'related_to',
        fromKey: input.repo.key,
        toKey: n.key,
        confidence: RELATED_TO_CONFIDENCE,
      });
    }
  }

  const seen = new Set<string>();
  const nodes: MappedNode[] = [];
  for (const c of candidates) {
    if (seen.has(lower(c.key))) continue;
    seen.add(lower(c.key));
    nodes.push(resolveNode(c, board));
  }
  return { nodes, edges };
}
