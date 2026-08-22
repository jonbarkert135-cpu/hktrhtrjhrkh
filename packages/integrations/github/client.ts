/**
 * The counting GitHub HTTP client (11_GITHUB.md §5.9, §8).
 *
 * One place owns the three rules that must never diverge: spend the budget *before* a request
 * (§8.1), stop at the per-analysis request cap instead of failing (§5.9), and map every non-2xx
 * onto §9's error codes. Transport is injected — `packages/integrations` stays runtime-free and the
 * tests run offline; the worker passes a `safeFetch`-backed transport so N7 (SSRF) still holds.
 */

import {
  analysisRequestCap,
  canSpend,
  readBudget,
  spend,
  type HeaderLookup,
  type RateBudget,
  type RequestUrgency,
} from './budget.ts';
import { classifyResponse, GithubError } from './errors.ts';
import { GITHUB_API_HOST, GITHUB_RAW_HOST } from './manifest.ts';

export interface HttpResponse {
  readonly status: number;
  readonly headers: HeaderLookup;
  readonly body: string;
}

/** The one seam to the network. `url` is always on an allowlisted GitHub host. */
export type GithubHttp = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => Promise<HttpResponse>;

export interface GithubClientOptions {
  readonly http: GithubHttp;
  /** Bearer token, when a credential was selected (`auth/select.ts`). Absent = anonymous. */
  readonly token?: string | undefined;
  readonly urgency?: RequestUrgency | undefined;
  readonly nowMs?: number | undefined;
  /** Per-analysis request cap; defaults to §5.9's value for the auth mode. */
  readonly maxRequests?: number | undefined;
}

/** Raised when the client refuses to spend a request; never a failure of the analysis (§5.9). */
export class BudgetExhausted extends Error {
  constructor(readonly reason: 'cap' | 'rate_limited' | 'deferred') {
    super(reason);
    this.name = 'BudgetExhausted';
  }
}

const API_VERSION_HEADERS: Readonly<Record<string, string>> = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'raven-github-analyzer',
};

export class GithubClient {
  private budget: RateBudget;
  private used = 0;
  private readonly cap: number;

  constructor(private readonly options: GithubClientOptions) {
    const now = options.nowMs ?? Date.now();
    this.budget = readBudget(() => null, now);
    this.cap = options.maxRequests ?? analysisRequestCap(options.token !== undefined);
  }

  /** Requests spent so far — the analysis reports it, and tests assert on it. */
  get requestsUsed(): number {
    return this.used;
  }

  get rateBudget(): RateBudget {
    return this.budget;
  }

  get remainingRequests(): number {
    return Math.max(0, this.cap - this.used);
  }

  /** `GET /path` on the API host, JSON-decoded. `null` on 404 so callers can treat it as absent. */
  async json<T>(path: string): Promise<T | null> {
    const response = await this.send(`https://${GITHUB_API_HOST}${path}`, this.apiHeaders());
    if (response === null) return null;
    try {
      return JSON.parse(response.body) as T;
    } catch {
      throw new GithubError('GH_PARSE', { detail: { path } });
    }
  }

  /** A raw file at an immutable commit; `null` when missing or over `maxBytes` (§5.4). */
  async raw(
    repoKey: string,
    sha: string,
    filePath: string,
    maxBytes = 262_144,
  ): Promise<string | null> {
    const url = `https://${GITHUB_RAW_HOST}/${repoKey}/${sha}/${filePath}`;
    const response = await this.send(url, {
      accept: 'text/plain',
      ...tokenHeader(this.options.token),
    });
    if (response === null) return null;
    return response.body.length > maxBytes ? null : response.body;
  }

  private apiHeaders(): Record<string, string> {
    return { ...API_VERSION_HEADERS, ...tokenHeader(this.options.token) };
  }

  /** Returns `null` for 404 (an expected answer here), throws for every other error status. */
  private async send(url: string, headers: Record<string, string>): Promise<HttpResponse | null> {
    if (this.used >= this.cap) throw new BudgetExhausted('cap');
    const decision = canSpend(this.budget, this.options.urgency ?? 'user-initiated');
    if (!decision.allow) throw new BudgetExhausted(decision.reason);

    this.used += 1;
    this.budget = spend(this.budget);

    let response: HttpResponse;
    try {
      response = await this.options.http(url, headers);
    } catch (cause) {
      throw new GithubError('GH_NETWORK', { detail: { url, cause: String(cause) } });
    }
    // GitHub's own numbers beat our local decrement whenever it sends them.
    this.budget = readBudget(response.headers, this.options.nowMs ?? Date.now());

    const error = classifyResponse({
      status: response.status,
      headers: response.headers,
      body: response.body,
    });
    if (error !== null) {
      if (error.code === 'GH_NOT_FOUND') return null;
      throw error;
    }
    return response;
  }
}

function tokenHeader(token: string | undefined): Record<string, string> {
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
}
