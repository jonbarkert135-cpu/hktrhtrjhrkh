/**
 * Rate-limit accounting for the GitHub adapter (11_GITHUB.md §8).
 *
 * Pure functions over headers and a stored budget: the adapter decides *before* a request whether
 * it may spend one, so we never burn a request just to learn we are limited (§8.1). Nothing here
 * talks to Redis — the caller owns storage; this file owns the arithmetic and the thresholds.
 */

/** The conservative fallback when GitHub sends no `x-ratelimit-*` headers at all (§2.1). */
export const FALLBACK_BUDGET_PER_HOUR = 60;
/** Analysis cap in anonymous mode (§2.1, §5.9). */
export const ANALYSIS_MAX_REQUESTS_UNAUTH = 12;
/** Instance-wide ceiling protecting the shared IP in anonymous mode (§8.2). */
export const GITHUB_MAX_RPS = 20;
export const MAX_CONCURRENT_PER_CREDENTIAL = 10;
export const MAX_SECONDARY_ATTEMPTS = 5;

export interface RateBudget {
  readonly limit: number;
  readonly remaining: number;
  /** Epoch seconds, as GitHub reports it. */
  readonly reset: number;
  readonly resource: string;
  /** False when the response carried no `x-ratelimit-*` headers, so this is the fallback. */
  readonly fromHeaders: boolean;
}

export type HeaderLookup = (name: string) => string | null | undefined;

const integer = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * Reads the budget GitHub reports. When the headers are absent (some GitHub Enterprise setups)
 * the caller gets the documented 60 req/h fallback with `fromHeaders: false`, never "unlimited".
 */
export function readBudget(headers: HeaderLookup, nowMs: number): RateBudget {
  const limit = integer(headers('x-ratelimit-limit'));
  const remaining = integer(headers('x-ratelimit-remaining'));
  const reset = integer(headers('x-ratelimit-reset'));
  const resource = headers('x-ratelimit-resource') ?? 'core';
  const nextHour = Math.floor(nowMs / 1000) + 3600;

  if (limit === null || remaining === null) {
    return {
      limit: FALLBACK_BUDGET_PER_HOUR,
      remaining: FALLBACK_BUDGET_PER_HOUR,
      reset: reset ?? nextHour,
      resource,
      fromHeaders: false,
    };
  }
  return {
    limit,
    remaining: Math.min(remaining, limit),
    reset: reset ?? nextHour,
    resource,
    fromHeaders: true,
  };
}

/** Spend one request locally; a `304` must not be counted (§8.1), so the caller decides. */
export function spend(budget: RateBudget, count = 1): RateBudget {
  return { ...budget, remaining: Math.max(0, budget.remaining - count) };
}

export type BudgetState = 'normal' | 'low' | 'critical' | 'exhausted';

/** §8.1's thresholds, expressed as a state so the UI and the gate agree on one rule. */
export function budgetState(budget: RateBudget): BudgetState {
  if (budget.remaining <= 0) return 'exhausted';
  if (budget.limit <= 0) return 'exhausted';
  const share = budget.remaining / budget.limit;
  if (share < 0.05) return 'critical';
  if (share <= 0.2) return 'low';
  return 'normal';
}

export type RequestUrgency = 'background' | 'user-initiated' | 'user-waiting';

export type SpendDecision =
  | { readonly allow: true }
  | {
      readonly allow: false;
      readonly reason: 'rate_limited' | 'deferred';
      readonly retryAt: number;
    };

/**
 * §8.1: background refreshes stop first, user-initiated work stops next, and at zero everything is
 * rejected locally with the reset time attached.
 */
export function canSpend(budget: RateBudget, urgency: RequestUrgency): SpendDecision {
  const retryAt = budget.reset * 1000;
  const state = budgetState(budget);
  if (state === 'exhausted') return { allow: false, reason: 'rate_limited', retryAt };
  if (state === 'normal') return { allow: true };
  if (state === 'low') {
    return urgency === 'background'
      ? { allow: false, reason: 'deferred', retryAt }
      : { allow: true };
  }
  return urgency === 'user-waiting'
    ? { allow: true }
    : { allow: false, reason: 'deferred', retryAt };
}

/** A response that means "you are being throttled", separate from the primary quota (§8.2). */
export function isSecondaryLimit(status: number, headers: HeaderLookup, body = ''): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  return (
    (headers('retry-after') ?? '') !== '' || body.toLowerCase().includes('secondary rate limit')
  );
}

/**
 * §8.2's backoff: honour `retry-after` when GitHub sends one, otherwise exponential with jitter,
 * capped at 15 minutes. `jitter` is injected so the schedule is reproducible in tests.
 */
export function secondaryBackoffMs(
  attempt: number,
  headers: HeaderLookup,
  jitter: () => number = Math.random,
): number {
  const retryAfter = integer(headers('retry-after'));
  if (retryAfter !== null) return retryAfter * 1000;
  const base = Math.min(60_000 * 2 ** Math.max(0, attempt), 15 * 60_000);
  return Math.round(base * (0.8 + jitter() * 0.4));
}

/** Requests a full analysis may spend, before per-step skipping (§2.1, §5.9). */
export function analysisRequestCap(authenticated: boolean): number {
  return authenticated ? Number.POSITIVE_INFINITY : ANALYSIS_MAX_REQUESTS_UNAUTH;
}
