/** GitHub rate-limit accounting (11_GITHUB.md §8): decide before spending, never guess a budget. */

import { describe, expect, it } from 'vitest';

import {
  ANALYSIS_MAX_REQUESTS_UNAUTH,
  FALLBACK_BUDGET_PER_HOUR,
  analysisRequestCap,
  budgetState,
  canSpend,
  isSecondaryLimit,
  readBudget,
  secondaryBackoffMs,
  spend,
  type RateBudget,
} from '../github/budget.ts';

const NOW = Date.parse('2026-02-01T12:00:00.000Z');
const RESET = Math.floor(NOW / 1000) + 1800;

const headers = (values: Record<string, string>) => (name: string) => values[name] ?? null;

const budget = (over: Partial<RateBudget> = {}): RateBudget => ({
  limit: 5000,
  remaining: 5000,
  reset: RESET,
  resource: 'core',
  fromHeaders: true,
  ...over,
});

describe('readBudget (§2.1, §8.1)', () => {
  it('reads what GitHub reports', () => {
    expect(
      readBudget(
        headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4998',
          'x-ratelimit-reset': String(RESET),
          'x-ratelimit-resource': 'core',
        }),
        NOW,
      ),
    ).toEqual({ limit: 5000, remaining: 4998, reset: RESET, resource: 'core', fromHeaders: true });
  });

  it('falls back to 60 req/h when the headers are absent, never to unlimited', () => {
    const result = readBudget(headers({}), NOW);
    expect(result).toMatchObject({
      limit: FALLBACK_BUDGET_PER_HOUR,
      remaining: FALLBACK_BUDGET_PER_HOUR,
      fromHeaders: false,
      resource: 'core',
    });
    expect(result.reset).toBe(Math.floor(NOW / 1000) + 3600);
  });

  it('ignores nonsense header values and clamps remaining to the limit', () => {
    expect(readBudget(headers({ 'x-ratelimit-limit': 'lots' }), NOW).fromHeaders).toBe(false);
    expect(
      readBudget(headers({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '900' }), NOW)
        .remaining,
    ).toBe(60);
  });
});

describe('spend', () => {
  it('never goes below zero and defaults to one request', () => {
    expect(spend(budget({ remaining: 2 })).remaining).toBe(1);
    expect(spend(budget({ remaining: 1 }), 5).remaining).toBe(0);
  });
});

describe('budgetState thresholds (§8.1)', () => {
  it.each<[number, string]>([
    [5000, 'normal'],
    [1001, 'normal'],
    [1000, 'low'],
    [250, 'low'],
    [200, 'critical'],
    [0, 'exhausted'],
  ])('remaining %i of 5000 is %s', (remaining, state) => {
    expect(budgetState(budget({ remaining }))).toBe(state);
  });

  it('treats a zero limit as exhausted rather than dividing by zero', () => {
    expect(budgetState(budget({ limit: 0, remaining: 0 }))).toBe('exhausted');
  });
});

describe('canSpend (§8.1)', () => {
  it('lets everything through above 20 %', () => {
    for (const urgency of ['background', 'user-initiated', 'user-waiting'] as const) {
      expect(canSpend(budget(), urgency)).toEqual({ allow: true });
    }
  });

  it('defers background refreshes between 5 % and 20 %', () => {
    const low = budget({ remaining: 500 });
    expect(canSpend(low, 'background')).toEqual({
      allow: false,
      reason: 'deferred',
      retryAt: RESET * 1000,
    });
    expect(canSpend(low, 'user-initiated')).toEqual({ allow: true });
  });

  it('below 5 % only the request a user is waiting on proceeds', () => {
    const critical = budget({ remaining: 100 });
    expect(canSpend(critical, 'user-waiting')).toEqual({ allow: true });
    expect(canSpend(critical, 'user-initiated')).toMatchObject({
      allow: false,
      reason: 'deferred',
    });
  });

  it('at zero rejects locally with the reset time, burning no request', () => {
    expect(canSpend(budget({ remaining: 0 }), 'user-waiting')).toEqual({
      allow: false,
      reason: 'rate_limited',
      retryAt: RESET * 1000,
    });
  });
});

describe('secondary limits (§8.2)', () => {
  it.each<[string, number, Record<string, string>, string, boolean]>([
    ['a 429', 429, {}, '', true],
    ['a 403 with retry-after', 403, { 'retry-after': '60' }, '', true],
    ['a 403 naming the secondary limit', 403, {}, 'You have exceeded a secondary rate limit', true],
    ['a plain 403', 403, {}, 'Forbidden', false],
    ['a 404', 404, {}, '', false],
  ])('detects %s', (_label, status, values, body, expected) => {
    expect(isSecondaryLimit(status, headers(values), body)).toBe(expected);
  });

  it('honours retry-after over its own backoff', () => {
    expect(secondaryBackoffMs(3, headers({ 'retry-after': '45' }))).toBe(45_000);
  });

  it('backs off exponentially with jitter and caps at 15 minutes', () => {
    expect(secondaryBackoffMs(0, headers({}), () => 0.5)).toBe(60_000);
    expect(secondaryBackoffMs(1, headers({}), () => 0.5)).toBe(120_000);
    expect(secondaryBackoffMs(9, headers({}), () => 0.5)).toBe(900_000);
    expect(secondaryBackoffMs(0, headers({}), () => 0)).toBe(48_000);
    expect(secondaryBackoffMs(0, headers({}), () => 1)).toBe(72_000);
  });
});

describe('analysisRequestCap (§2.1, §5.9)', () => {
  it('caps anonymous analyses and leaves authenticated ones to the primary budget', () => {
    expect(analysisRequestCap(false)).toBe(ANALYSIS_MAX_REQUESTS_UNAUTH);
    expect(analysisRequestCap(true)).toBe(Number.POSITIVE_INFINITY);
  });
});
