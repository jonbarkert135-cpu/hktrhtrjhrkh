/**
 * Fixed-window counters for the auth-specific limits of 20_ROADMAP.md P1 §9:
 * 10 logins / 5 min / (IP+email), 5 signups / hour / IP.
 *
 * ponytail: in-process Map, so limits are per API replica. Ceiling: correct for the P1
 * single-replica dev/compose deployment. Upgrade path: swap `hit()` for a Redis
 * INCR+EXPIRE against REDIS_URL (ioredis is already a dependency) — the call sites and
 * the returned shape stay identical.
 */

export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Seconds until the window resets — used verbatim as the `Retry-After` header. */
  readonly retryAfterSec: number;
}

export const LOGIN_RULE: RateLimitRule = { limit: 10, windowMs: 5 * 60_000 };
export const SIGNUP_RULE: RateLimitRule = { limit: 5, windowMs: 60 * 60_000 };
/** Per-user API budget, enforced by @fastify/rate-limit (see plugins/rate-limit usage). */
export const USER_API_RULE: RateLimitRule = { limit: 100, windowMs: 60_000 };

interface Window {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  readonly #windows = new Map<string, Window>();

  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, rule: RateLimitRule): RateLimitResult {
    const t = this.now();
    const existing = this.#windows.get(key);
    const window =
      existing && existing.resetAt > t ? existing : { count: 0, resetAt: t + rule.windowMs };
    window.count += 1;
    this.#windows.set(key, window);
    if (this.#windows.size > 10_000) this.#evict(t);

    const retryAfterSec = Math.max(1, Math.ceil((window.resetAt - t) / 1000));
    return {
      allowed: window.count <= rule.limit,
      remaining: Math.max(0, rule.limit - window.count),
      retryAfterSec,
    };
  }

  reset(): void {
    this.#windows.clear();
  }

  #evict(t: number): void {
    for (const [key, window] of this.#windows) {
      if (window.resetAt <= t) this.#windows.delete(key);
    }
  }
}

export const authLimiter = new FixedWindowLimiter();

export const loginKey = (ip: string, email: string): string =>
  `login:${ip}:${email.trim().toLowerCase()}`;
export const signupKey = (ip: string): string => `signup:${ip}`;
