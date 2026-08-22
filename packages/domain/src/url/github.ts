/**
 * GitHub URL detection and canonicalization (11_GITHUB.md §3).
 *
 * Pure and synchronous by contract: this runs inside the paste pipeline (P6) under a ≤ 1 ms budget,
 * before any network call, so a pasted `github.com/owner/repo` becomes a repository node candidate
 * immediately. Anything this file cannot recognise returns `null` and the paste falls through to
 * the generic link unfurler — an unrecognised host is never guessed at.
 *
 * The key (`githubRefKey`) is the dedupe identity (§7.2): owner and repo are case-folded there,
 * while the original case is preserved for display in `canonicalGithubUrl`.
 */

/** Max lines a `#L12-L400` selection may span before it is clamped (§3.4 step 9). */
export const MAX_BLOB_RANGE_LINES = 400;

export type GithubRef =
  | { kind: 'repo'; owner: string; repo: string; ref?: string }
  | { kind: 'owner'; owner: string; ownerType: 'user' | 'org' | 'unknown' }
  | { kind: 'path'; owner: string; repo: string; ref: string; path: string; dir: boolean }
  | {
      kind: 'blobRange';
      owner: string;
      repo: string;
      ref: string;
      path: string;
      startLine: number;
      endLine: number | null;
    }
  | { kind: 'issue'; owner: string; repo: string; number: number }
  | { kind: 'pull'; owner: string; repo: string; number: number }
  | { kind: 'discussion'; owner: string; repo: string; number: number }
  | { kind: 'release'; owner: string; repo: string; tag: string }
  | { kind: 'commit'; owner: string; repo: string; sha: string }
  | { kind: 'compare'; owner: string; repo: string; base: string; head: string }
  | { kind: 'gist'; owner: string | null; gistId: string }
  | { kind: 'raw'; owner: string; repo: string; ref: string; path: string };

export type GithubRefKind = GithubRef['kind'];

/** Hosts §3.2 recognises, minus the configurable enterprise host. */
export const GITHUB_HOSTS = [
  'github.com',
  'raw.githubusercontent.com',
  'gist.github.com',
  'objects.githubusercontent.com',
] as const;

export interface ParseGithubUrlOptions {
  /** `GITHUB_ENTERPRISE_HOST`; treated exactly like `github.com` when it matches. */
  readonly enterpriseHost?: string | undefined;
}

/** Percent-decodes one segment; a segment that hides a separator is rejected (§3.4 step 5). */
function decodeSegment(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return decoded.includes('/') || decoded === '' ? null : decoded;
}

function segments(pathname: string): string[] | null {
  const raw = pathname.split('/').filter((part) => part !== '');
  const out: string[] = [];
  for (const part of raw) {
    const decoded = decodeSegment(part);
    if (decoded === null) return null;
    out.push(decoded);
  }
  return out;
}

/** `#L12` / `#L12-L48`; end before start swaps, and the span is clamped (§3.4 step 9). */
function lineRange(hash: string): { startLine: number; endLine: number | null } | null {
  const match = /^#L(\d+)(?:-L(\d+))?$/.exec(hash);
  if (match === null) return null;
  const first = Number(match[1]);
  if (!Number.isSafeInteger(first) || first < 1) return null;
  if (match[2] === undefined) return { startLine: first, endLine: null };
  const second = Number(match[2]);
  if (!Number.isSafeInteger(second) || second < 1) return { startLine: first, endLine: null };
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  return { startLine: start, endLine: Math.min(end, start + MAX_BLOB_RANGE_LINES - 1) };
}

const stripGitSuffix = (repo: string): string => (repo.endsWith('.git') ? repo.slice(0, -4) : repo);

/** A repo-scoped route: `/{owner}/{repo}/{verb}/…`. */
function repoRoute(owner: string, repo: string, rest: string[], hash: string): GithubRef | null {
  const [verb, ...tail] = rest;
  if (verb === undefined) return { kind: 'repo', owner, repo };

  const numbered = (kind: 'issue' | 'pull' | 'discussion'): GithubRef | null => {
    const number = Number(tail[0]);
    // `/pull/12/files` and `/pull/12#discussion_r1` collapse to the pull request itself (§3.3).
    return Number.isSafeInteger(number) && number > 0 ? { kind, owner, repo, number } : null;
  };

  switch (verb) {
    case 'tree':
    case 'blob': {
      const [ref, ...pathParts] = tail;
      if (ref === undefined) return { kind: 'repo', owner, repo };
      const path = pathParts.join('/');
      if (verb === 'tree') return { kind: 'path', owner, repo, ref, path, dir: true };
      if (path === '') return { kind: 'repo', owner, repo, ref };
      const range = lineRange(hash);
      return range === null
        ? { kind: 'path', owner, repo, ref, path, dir: false }
        : { kind: 'blobRange', owner, repo, ref, path, ...range };
    }
    case 'issues':
      return numbered('issue');
    case 'pull':
    case 'pulls':
      return numbered('pull');
    case 'discussions':
      return numbered('discussion');
    case 'releases': {
      if (tail[0] === 'latest') return { kind: 'release', owner, repo, tag: 'latest' };
      if (tail[0] === 'tag' && tail[1] !== undefined) {
        return { kind: 'release', owner, repo, tag: tail.slice(1).join('/') };
      }
      return null;
    }
    case 'commit':
    case 'commits': {
      const sha = tail[0];
      return sha !== undefined && /^[0-9a-f]{7,40}$/i.test(sha)
        ? { kind: 'commit', owner, repo, sha: sha.toLowerCase() }
        : null;
    }
    case 'compare': {
      const spec = tail.join('/');
      const parts = spec.split('...');
      const [base, head] = parts;
      return parts.length === 2 &&
        base !== undefined &&
        base !== '' &&
        head !== undefined &&
        head !== ''
        ? { kind: 'compare', owner, repo, base, head }
        : null;
    }
    default:
      // Any other repo sub-route (`/settings`, `/actions`, …) is still that repository.
      return { kind: 'repo', owner, repo };
  }
}

function fromGithubHost(parts: string[], hash: string): GithubRef | null {
  const [first, second, ...rest] = parts;
  if (first === undefined) return null;
  if (first === 'orgs') {
    return second === undefined ? null : { kind: 'owner', owner: second, ownerType: 'org' };
  }
  // Reserved single-segment routes are site pages, not owners.
  if (RESERVED_OWNERS.has(first.toLowerCase())) return null;
  if (second === undefined) return { kind: 'owner', owner: first, ownerType: 'unknown' };
  const repo = stripGitSuffix(second);
  return repo === '' ? null : repoRoute(first, repo, rest, hash);
}

/** github.com paths that are site features rather than an owner (§3.3 note). */
const RESERVED_OWNERS = new Set([
  'about',
  'apps',
  'blog',
  'collections',
  'contact',
  'customer-stories',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'pricing',
  'pulls',
  'search',
  'security',
  'settings',
  'sponsors',
  'topics',
  'trending',
]);

export function parseGithubUrl(
  input: string,
  options: ParseGithubUrlOptions = {},
): GithubRef | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const enterprise = options.enterpriseHost?.toLowerCase().replace(/^www\./, '');
  const parts = segments(url.pathname);
  if (parts === null) return null;

  if (host === 'gist.github.com') {
    const [first, second] = parts;
    if (first === undefined) return null;
    return second === undefined
      ? { kind: 'gist', owner: null, gistId: first }
      : { kind: 'gist', owner: first, gistId: second };
  }

  if (host === 'raw.githubusercontent.com') {
    const [owner, repo, ref, ...pathParts] = parts;
    const path = pathParts.join('/');
    if (owner === undefined || repo === undefined || ref === undefined || path === '') return null;
    return { kind: 'raw', owner, repo: stripGitSuffix(repo), ref, path };
  }

  // A release asset URL carries its release in the path; anything else on that host is opaque.
  if (host === 'objects.githubusercontent.com') return null;

  if (host === 'github.com' || (enterprise !== undefined && host === enterprise)) {
    return fromGithubHost(parts, url.hash);
  }
  return null;
}

const repoPath = (ref: { owner: string; repo: string }): string => `${ref.owner}/${ref.repo}`;

/** A stable `https://github.com/…` URL: original case, no trailing slash, no query (§3.4). */
export function canonicalGithubUrl(ref: GithubRef): string {
  const base = 'https://github.com';
  switch (ref.kind) {
    case 'repo':
      return ref.ref === undefined
        ? `${base}/${repoPath(ref)}`
        : `${base}/${repoPath(ref)}/tree/${ref.ref}`;
    case 'owner':
      return `${base}/${ref.owner}`;
    case 'path':
      return `${base}/${repoPath(ref)}/${ref.dir ? 'tree' : 'blob'}/${ref.ref}${
        ref.path === '' ? '' : `/${ref.path}`
      }`;
    case 'blobRange':
      return `${base}/${repoPath(ref)}/blob/${ref.ref}/${ref.path}#L${String(ref.startLine)}${
        ref.endLine === null ? '' : `-L${String(ref.endLine)}`
      }`;
    case 'issue':
      return `${base}/${repoPath(ref)}/issues/${String(ref.number)}`;
    case 'pull':
      return `${base}/${repoPath(ref)}/pull/${String(ref.number)}`;
    case 'discussion':
      return `${base}/${repoPath(ref)}/discussions/${String(ref.number)}`;
    case 'release':
      return ref.tag === 'latest'
        ? `${base}/${repoPath(ref)}/releases/latest`
        : `${base}/${repoPath(ref)}/releases/tag/${ref.tag}`;
    case 'commit':
      return `${base}/${repoPath(ref)}/commit/${ref.sha}`;
    case 'compare':
      return `${base}/${repoPath(ref)}/compare/${ref.base}...${ref.head}`;
    case 'gist':
      return ref.owner === null
        ? `https://gist.github.com/${ref.gistId}`
        : `https://gist.github.com/${ref.owner}/${ref.gistId}`;
    case 'raw':
      // §3.3: a raw URL is canonicalized to its blob URL.
      return `${base}/${repoPath(ref)}/blob/${ref.ref}/${ref.path}`;
  }
}

/** The dedupe identity (§3.4, §7.2). Owner and repo are case-folded; refs and paths are not. */
export function githubRefKey(ref: GithubRef): string {
  const slug = (r: { owner: string; repo: string }): string =>
    `${r.owner.toLowerCase()}/${r.repo.toLowerCase()}`;
  switch (ref.kind) {
    case 'repo':
      return `gh:repo:${slug(ref)}`;
    case 'owner':
      return `gh:owner:${ref.owner.toLowerCase()}`;
    case 'path':
      return `gh:${ref.dir ? 'tree' : 'blob'}:${slug(ref)}@${ref.ref}:${ref.path}`;
    case 'blobRange':
      return `gh:blob:${slug(ref)}@${ref.ref}:${ref.path}#L${String(ref.startLine)}${
        ref.endLine === null ? '' : `-L${String(ref.endLine)}`
      }`;
    case 'issue':
      return `gh:issue:${slug(ref)}#${String(ref.number)}`;
    case 'pull':
      return `gh:pull:${slug(ref)}#${String(ref.number)}`;
    case 'discussion':
      return `gh:discussion:${slug(ref)}#${String(ref.number)}`;
    case 'release':
      return `gh:release:${slug(ref)}@${ref.tag}`;
    case 'commit':
      return `gh:commit:${slug(ref)}@${ref.sha}`;
    case 'compare':
      return `gh:compare:${slug(ref)}@${ref.base}...${ref.head}`;
    case 'gist':
      return `gh:gist:${ref.gistId.toLowerCase()}`;
    case 'raw':
      return `gh:blob:${slug(ref)}@${ref.ref}:${ref.path}`;
  }
}

/** The node kind §3.3's table produces for a ref, before any API call. */
export function githubNodeKind(ref: GithubRef): string {
  switch (ref.kind) {
    case 'repo':
      return 'repository';
    case 'owner':
      return ref.ownerType === 'org' ? 'organization' : 'person';
    case 'path':
      return ref.dir ? (ref.path === '' ? 'repository' : 'repo_path') : 'code_file';
    case 'blobRange':
      return 'code_snippet';
    case 'raw':
      return 'code_file';
    case 'compare':
      return 'note';
    case 'issue':
      return 'issue';
    case 'pull':
      return 'pull_request';
    case 'discussion':
      return 'discussion';
    case 'release':
      return 'release';
    case 'commit':
      return 'commit';
    case 'gist':
      return 'gist';
  }
}
