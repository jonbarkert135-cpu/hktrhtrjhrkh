/**
 * GitHub error codes and copy (11_GITHUB.md §9).
 *
 * The codes are stable and used in telemetry; the copy follows 00_MASTER.md §10.5 (what happened /
 * why / what to do). A bare 403 or a generic "request failed" is a bug here, not a fallback.
 */

import { isSecondaryLimit, type HeaderLookup } from './budget.ts';

export const GITHUB_ERROR_CODES = [
  'GH_RATE_PRIMARY',
  'GH_RATE_SECONDARY',
  'GH_NOT_FOUND',
  'GH_FORBIDDEN',
  'GH_AUTH_REVOKED',
  'GH_NETWORK',
  'GH_PARSE',
  'GH_TOO_LARGE',
  'GH_ANALYSIS_PARTIAL',
  'GH_TRUNCATED_TREE',
] as const;

export type GithubErrorCode = (typeof GITHUB_ERROR_CODES)[number];

export interface GithubErrorCopy {
  readonly code: GithubErrorCode;
  readonly title: string;
  readonly body: string;
  readonly action: string;
  /** Epoch ms the caller may retry at; only set for the two rate-limit codes. */
  readonly retryAt?: number;
}

export class GithubError extends Error {
  readonly code: GithubErrorCode;
  readonly retryAt: number | undefined;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(
    code: GithubErrorCode,
    options: { retryAt?: number | undefined; detail?: Record<string, unknown> } = {},
  ) {
    super(code);
    this.name = 'GithubError';
    this.code = code;
    this.retryAt = options.retryAt;
    this.detail = options.detail ?? {};
  }
}

export interface ClassifyInput {
  readonly status: number;
  readonly headers: HeaderLookup;
  readonly body?: string;
}

/**
 * Maps one HTTP response onto §9's table. A `403` is only `GH_FORBIDDEN` once it is neither the
 * primary quota (remaining 0) nor a secondary limit — those have their own copy and their own
 * retry semantics.
 */
export function classifyResponse(input: ClassifyInput): GithubError | null {
  const { status, headers } = input;
  const body = input.body ?? '';
  if (status >= 200 && status < 400) return null;

  const remaining = headers('x-ratelimit-remaining');
  const reset = Number(headers('x-ratelimit-reset') ?? '0');
  const retryAt = Number.isSafeInteger(reset) && reset > 0 ? reset * 1000 : undefined;

  if (isSecondaryLimit(status, headers, body)) {
    return new GithubError('GH_RATE_SECONDARY', { detail: { status } });
  }
  if (status === 403 && remaining === '0') {
    return new GithubError('GH_RATE_PRIMARY', { retryAt, detail: { status } });
  }
  if (status === 401) return new GithubError('GH_AUTH_REVOKED', { detail: { status } });
  if (status === 403) return new GithubError('GH_FORBIDDEN', { detail: { status } });
  if (status === 404) return new GithubError('GH_NOT_FOUND', { detail: { status } });
  if (status === 413) return new GithubError('GH_TOO_LARGE', { detail: { status } });
  if (status >= 500) return new GithubError('GH_NETWORK', { detail: { status } });
  return new GithubError('GH_PARSE', { detail: { status } });
}

const minutesUntil = (retryAt: number | undefined, nowMs: number): string => {
  if (retryAt === undefined) return 'shortly';
  const minutes = Math.max(1, Math.round((retryAt - nowMs) / 60_000));
  return `in ${String(minutes)} min`;
};

export interface CopyContext {
  readonly nowMs?: number;
  readonly owner?: string;
  readonly repo?: string;
  /** Last time the cached data on the canvas was observed, for the 404 copy. */
  readonly cachedAt?: string;
  readonly authenticated?: boolean;
  readonly skipped?: number;
  readonly total?: number;
  readonly analyzedDirectories?: number;
  readonly fileBytes?: number;
  readonly previewCapBytes?: number;
}

/** §9's copy quotes sizes the way a person reads them: KB below a megabyte, MB above. */
const fileSize = (bytes: number): string =>
  bytes < 1_048_576
    ? `${String(Math.round(bytes / 1024))} KB`
    : `${(bytes / 1_048_576).toFixed(1)} MB`;

/** §9's table as data: one place produces the user-visible strings for a code. */
export function githubErrorCopy(error: GithubError, context: CopyContext = {}): GithubErrorCopy {
  const now = context.nowMs ?? Date.now();
  const slug = `github.com/${context.owner ?? 'owner'}/${context.repo ?? 'repo'}`;
  switch (error.code) {
    case 'GH_RATE_PRIMARY':
      return {
        code: error.code,
        title: 'GitHub rate limit reached',
        body: `Your GitHub quota resets ${minutesUntil(error.retryAt, now)}. Cached data is still shown.`,
        action: context.authenticated === true ? 'Notify me when it resets' : 'Connect an account',
        ...(error.retryAt === undefined ? {} : { retryAt: error.retryAt }),
      };
    case 'GH_RATE_SECONDARY':
      return {
        code: error.code,
        title: 'GitHub is throttling requests',
        body: 'Too many requests in a short time. Raven paused GitHub calls and will resume automatically.',
        action: 'Retry now',
        ...(error.retryAt === undefined ? {} : { retryAt: error.retryAt }),
      };
    case 'GH_NOT_FOUND':
      return {
        code: error.code,
        title: 'Repository not accessible',
        body: `${slug} returned 404 — it may be private, renamed or deleted. The data from ${
          context.cachedAt ?? 'the last successful run'
        } is still on the canvas.`,
        action: 'Open on GitHub',
      };
    case 'GH_FORBIDDEN':
      return {
        code: error.code,
        title: 'Access denied by GitHub',
        body: 'Your GitHub connection lacks access to this resource. Private repositories need the `repo` scope.',
        action: 'Reconnect with private access',
      };
    case 'GH_AUTH_REVOKED':
      return {
        code: error.code,
        title: 'GitHub connection expired',
        body: 'Your GitHub authorization was revoked or expired. Existing data is intact.',
        action: 'Reconnect',
      };
    case 'GH_NETWORK':
      return {
        code: error.code,
        title: 'Could not reach GitHub',
        body: 'The request timed out. This is usually temporary.',
        action: 'Retry',
      };
    case 'GH_PARSE':
      return {
        code: error.code,
        title: 'Unexpected response from GitHub',
        body: 'Raven could not read GitHub’s response for this panel. The raw payload was saved for diagnostics.',
        action: 'Report issue',
      };
    case 'GH_TOO_LARGE':
      return {
        code: error.code,
        title: 'File too large to preview',
        body: `This file is ${fileSize(context.fileBytes ?? 0)}; Raven previews up to ${fileSize(
          context.previewCapBytes ?? 262_144,
        )}.`,
        action: 'Open on GitHub',
      };
    case 'GH_ANALYSIS_PARTIAL':
      return {
        code: error.code,
        title: 'Partial analysis',
        body: `${String(context.skipped ?? 0)} of ${String(
          context.total ?? 0,
        )} steps were skipped because of the anonymous request budget.`,
        action: 'Connect GitHub and re-run',
      };
    case 'GH_TRUNCATED_TREE':
      return {
        code: error.code,
        title: 'Large repository',
        body: `This repository’s file tree exceeds GitHub’s single-response limit; Raven analyzed the ${String(
          context.analyzedDirectories ?? 0,
        )} most relevant directories.`,
        action: 'See what was analyzed',
      };
  }
}
